import { MongoClient, ObjectId, WithId } from "mongodb";
import axios from "axios"
import { DB_NAME, TOKENS_PER_PAGE } from "./constants";
import { ROUTE, COLLECTION_NAME, DataDoc, ORDER, ReminderDoc, SORTING, Project, Source } from "./types";
import { Context, Markup, Telegraf } from "telegraf";
import { FmtString } from "telegraf/typings/format";
import { ExtraEditMessageText } from "telegraf/typings/telegram-types";
import { NavParams } from "./types";
import { Update } from "telegraf/typings/core/types/typegram";
import { CoinGeckoService } from "./services";

const remindersTimeoutHandlers: TimerHandler[] = []

export function getTickers(message: string) {
  const tickerRegex = /\$(?![0-9]+([kKmMbB][sS]?)?\b)(?!(0[xX][a-fA-F0-9]{40})\b)[a-zA-Z0-9]+/gm; // Ticker regex
  const tickers = message.match(tickerRegex) ?? [];
  return Array.from(tickers).map(ticker => ticker.replace('$', '').toUpperCase());
}

export async function getTokenInfos(client: MongoClient, ticker: string) {
  const collection = await getCollection<DataDoc>(client, COLLECTION_NAME.data)
  // How many times it was shilled

  const project = await collection.findOne({ ticker })

  if (!project) {
    return "No data"
  }

  const firstMessage = project.messages.sort((a, b) => a.date - b.date)[0]
  const mostTalkative = project.shillers.reduce<Array<{ shiller: string, count: number }>>(function (board, shiller) {
    const row = board.find((row) => row.shiller === shiller)
    if (row) {
      row.count++
    } else {
      board.push({ shiller, count: 1 })
    }
    return board
  }, [])
    .sort((a, b) => b.count - a.count)[0].shiller

  const date = addMs(project)

  return `Information for token: ${ticker}:
  - last shilled: ${date.toLocaleDateString()} ${date.toLocaleTimeString()}
  - shilled: ${project.messages.length} times in the group
  - first shilled by: @${firstMessage.author}
  - most talkative: @${mostTalkative}
  - first message: ${firstMessage.url}
`;
}

function addMs(project: DataDoc) {
  return new Date(project.messages.at(-1)!.date * 1000);
}

/**
 * Helper function to create inline keyboard buttons for tokens
 */
export async function createTokenButtons(client: MongoClient, { page, sortBy, order }: NavParams) {
  const collection = await getCollection<DataDoc>(client, COLLECTION_NAME.data)
  const noProject = await collection.countDocuments()
  const paginatedProjects = sortBy === SORTING.SHILL
    ? await collection.aggregate<DataDoc>([
      {
        $project: {
          ticker: 1,
          shillers: 1,
          messages: 1,
          numberOfMessages: { $size: "$messages" } // Calculer la taille du tableau messages
        }
      },
      {
        $sort: { numberOfMessages: -1 }
      }
    ]).skip(TOKENS_PER_PAGE * (page - 1))
      .limit(TOKENS_PER_PAGE)
      .toArray()

    : await collection.find()
      .sort(sortBy === SORTING.LAST_MENTION
        ? { "messages.date": -1 }
        : { ticker: order === ORDER.ASC ? 1 : -1 }
      )
      .skip(TOKENS_PER_PAGE * (page - 1))
      .limit(TOKENS_PER_PAGE)
      .toArray()

  const tokenButtons = paginatedProjects.map(function (project) {
    const title = sortBy === SORTING.LAST_MENTION
      ? `${project.ticker} (${getTime(addMs(project))})`
      : sortBy === SORTING.SHILL
        ? `${project.ticker} (${project.messages.length}x)`
        : project.ticker
    return Markup.button.callback(title, `${ROUTE.info}?t=${project.ticker}&p=${page}&s=${sortBy}&o=${order}`)
  });
  const rows = []
  const btPerRow = 3
  const noRows = Math.ceil(tokenButtons.length / btPerRow)
  for (let i = 0; i < noRows; i++) {
    const row = []
    for (let j = 0; j < btPerRow; j++) {
      row.push(tokenButtons[i * btPerRow + j] ?? Markup.button.callback(' ', 'noop'))
    }
    rows.push(row);
  }

  // Add the page number
  const noPages = Math.ceil((await collection.countDocuments()) / TOKENS_PER_PAGE)
  // Add a false button
  rows.push([Markup.button.callback(`${page}/${noPages}`, 'noop')])

  // Add navigation buttons if needed
  const totalPages = Math.ceil(noProject / TOKENS_PER_PAGE);
  const nav = []
  if (totalPages > 1) {
    if (page > 1) {
      nav.push(Markup.button.callback('« Prev', `${ROUTE.token_list}?p=${page - 1}&s=${sortBy}&o=${order}`));
    } else {
      nav.push(Markup.button.callback(' ', 'noop'))
    }
    if (page < totalPages) {
      nav.push(Markup.button.callback('Next »', `${ROUTE.token_list}?p=${page + 1}&s=${sortBy}&o=${order}`));
    } else {
      nav.push(Markup.button.callback(' ', 'noop'))
    }
  }

  rows.push(nav)

  // Add sorting buttons
  rows.push([
    Markup.button.callback("Most shilled", `${ROUTE.token_list}?p=${page}&s=${SORTING.SHILL}&o=${ORDER.DSC}`),
    Markup.button.callback("Recent first", `${ROUTE.token_list}?p=${page}&s=${SORTING.LAST_MENTION}&o=${ORDER.ASC}`),
    Markup.button.callback("Alphabetical", `${ROUTE.token_list}?p=${page}&s=${SORTING.NAME}&o=${ORDER.ASC}`),
  ])

  return Markup.inlineKeyboard(rows);
};

export async function getCollection<T extends DataDoc | ReminderDoc >(client: MongoClient, collectionName: COLLECTION_NAME) {
  const db = client.db(DB_NAME);
  const hasCollection = (await db.listCollections({}, { nameOnly: true }).toArray())
    .some(c => c.name === collectionName)

  // Check if the collection exists and create it with the schema if it doesn't
  if (!hasCollection) {
    const newCollection = await db.createCollection<T>(collectionName/* , {
        validator: dataSchema
      } */);
    console.log(`Collection ${collectionName} created with schema validation`);
    return newCollection
  } else {
    return db.collection<T>(collectionName)
  }
}

/**
 * Swallow the error if this is caused by "message is not modified" or propage the error otherwise
 */
export function editMessageText(ctx: Context, text: string | FmtString, extra?: ExtraEditMessageText) {
  ctx.editMessageText(text, extra)
    .catch(e => console.error("SAME_MESSAGE", e))
}

export function getTime(date: Date, full = false) {
  const now = Date.now()
  if (now - date.getTime() <= 24 * 3600 * 1000) {// if shilled today
    // Display hour
    return date.toLocaleTimeString(undefined, {
      year: full ? '2-digit' : undefined,
      month: full ? '2-digit' : undefined,
      day: full ? '2-digit' : undefined,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  }
  return '> 24h'
}

export function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0'); // JavaScript months are 0-indexed
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function getMessageURL(ctx: Context) {
  if (ctx.chat?.type === 'group') {
    return `https://t.me/${ctx.chat.type}/${ctx.message?.message_id}`;
  }
  if (ctx.chat?.type === 'supergroup') {
    return `https://t.me/c/${ctx.chat.id.toString().slice(4)}/${ctx.message?.message_id}`;
  }

  return '';
}

export function toSorting(value: number | null): SORTING {
  if (value === null) {
    return SORTING.LAST_MENTION
  }
  return SORTING[SORTING[value] as unknown as SORTING] as unknown as SORTING ?? SORTING.LAST_MENTION
}

export function toOrder(number: string | null): ORDER {
  return number === "-1" ? ORDER.ASC : ORDER.DSC
}

export function convertDate(dateString: string) {
  // Check if the date string matches the format
  if (!isDate(dateString)) {
    throw new Error(`Invalid date ${dateString}`);
  }

  // Parse the date string
  const [datePart, timePart] = dateString.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes] = timePart.split(':').map(Number);

  // Check for valid date and time
  if (month < 1 || month > 12 || day < 1 || day > 31 || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Invalid date ${dateString}`);
  }

  // Create a date object
  const date = new Date(Date.UTC(year, month - 1, day, hours, minutes));

  // Check for invalid dates like "2021-02-30"
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`Invalid date ${dateString}`);
  }

  // Return UTC timestamp
  return date.getTime();
}

// Regular expression to match the format "YYYY-MM-DD HH:mm"
const DATE_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

export function isDate(dateString: string) {
  return DATE_REGEX.test(dateString);
}

export async function addReminder(client: MongoClient, {chatId, ticker, date, note}: {chatId: number, ticker: string, date: number, note?: string}){
  const reminders = await getCollection<ReminderDoc>(client, COLLECTION_NAME.reminders)

  return reminders.insertOne({
    chatId,
    ticker,
    date,
    note
  })
}

export async function hasTicker(client: MongoClient, ticker: string) {
  const collection = await getCollection<DataDoc>(client, COLLECTION_NAME.data)
  const project = await collection.findOne({ticker})
  return !!project
}

export async function startReminders(client: MongoClient, bot: Telegraf<Context<Update>>) {
  const collection = await getCollection<ReminderDoc>(client, COLLECTION_NAME.reminders)
  const reminders = await collection.find().toArray()
  reminders.forEach(function(reminder) {
    startReminder(bot, client, reminder)
  })
}

export async function startReminder(bot: Telegraf<Context<Update>>, client: MongoClient, reminder: WithId<ReminderDoc>) {
  const timeout = reminder.date - Date.now()
  if (timeout > 0) { // prevent past event
    const handler = setTimeout(async function () {
      bot.telegram.sendMessage(
        reminder.chatId,
        `Reminder for ${reminder.ticker}
${reminder.note ?? ''}`
      );
      clearTimeout(handler);
      const collection = await getCollection<ReminderDoc>(client, COLLECTION_NAME.reminders)
      collection.findOneAndDelete({_id: reminder._id})
    }, timeout);
  }
}

export async function checkTickers(tickers: string[]): Promise<string[]> {

  return tickers.filter(t => CoinGeckoService.data.some(({symbol}) => symbol === t))

  const results: Project[] = [];

  for (const ticker of tickers) {
      // First try CoinGecko
      const coinGeckoResult = await fetchFromCoinGecko(ticker);
      if (coinGeckoResult) {
          results.push(coinGeckoResult);
          continue;
      }

      // Then try DextTool
      const dextToolResult = await fetchFromDextTool(ticker);
      if (dextToolResult) {
          results.push(dextToolResult);
      }
  }

  return results;
}

export async function fetchFromCoinGecko(ticker: string): Promise<Project | undefined> {
  try {
    // Replace with the appropriate CoinGecko API endpoint
    const url = `https://api.coingecko.com/api/v3/coins/${ticker}`;
    const response = await axios.get(url);

    // Assuming the response contains the data in a format you expect
    // You may need to adjust the accessors based on the actual API response structure
    const data = response.data;

    return {
        id: data.id, // or however the ID is represented in the response
        source: Source.CoinGecko,
        ticker: ticker, // or you may fetch it from data if available
    };
  } catch (error) {
      console.error('Error fetching from CoinGecko:', error);
  }
}

export async function fetchFromDextTool(ticker: string): Promise<Project | undefined> {
  try {
    // Replace with the appropriate DextTool API endpoint
    const url = `https://api.dextool.com/api/endpoint/${ticker}`;
    const response = await axios.get(url);

    // Parse the response based on DextTool's response structure
    // This will need to be adjusted based on the actual API response
    const data = response.data;

    return {
        id: data.id, // Adjust according to the actual response field for 'id'
        source: Source.DextTool,
        ticker: ticker, // or fetch from data if available
    };
  } catch (error) {
      console.error('Error fetching from DextTool:', error);
  }
}