import { MongoClient } from "mongodb";
import { COLLECTION_NAME, DB_NAME, TOKENS_PER_PAGE } from "./constants";
import { Data, ORDER, SORTING } from "./types";
import { Context, Markup } from "telegraf";
import { FmtString } from "telegraf/typings/format";
import { ExtraEditMessageText } from "telegraf/typings/telegram-types";
import { NavParams } from "./types";

export function getTickers(message: string) {
  const tickerRegex = /\$([a-zA-Z\d]+)\b/g; // Ticker regex
  const tickers = message.match(tickerRegex) ?? [];
  return Array.from(tickers).map(ticker => ticker.replace('$', '').toUpperCase());
}

export async function getTokenInfos(client: MongoClient, ticker: string) {
  const collection = await getCollection(client)
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

function addMs(project: Data) {
  return new Date(project.messages.at(-1)!.date * 1000);
}

/**
 * Helper function to create inline keyboard buttons for tokens
 */
export async function createTokenButtons(client: MongoClient, { page, sortBy, order }: NavParams) {
  const collection = await getCollection(client)
  const noProject = await collection.countDocuments()
  const paginatedProjects = sortBy === SORTING.SHILL
    ? await collection.aggregate<Data>([
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

  const tokenButtons = paginatedProjects.map(function(project) {
    const title = sortBy === SORTING.LAST_MENTION
      ? `${project.ticker} (${getShilledTime(addMs(project))})`
      : sortBy === SORTING.SHILL
      ? `${project.ticker} (${project.messages.length}x)`
      : project.ticker
    return Markup.button.callback(title, `info?ticker=${project.ticker}&page=${page}&sort_by=${sortBy}&order=${order}`)
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
  const noPages = Math.ceil((await collection.countDocuments())/ TOKENS_PER_PAGE)
  // Add a false button
  rows.push([Markup.button.callback(`${page}/${noPages}`, 'noop')])

  // Add navigation buttons if needed
  const totalPages = Math.ceil(noProject / TOKENS_PER_PAGE);
  const nav = []
  if (totalPages > 1) {
    if (page > 1) {
      nav.push(Markup.button.callback('« Prev', `token_list?page=${page - 1}&sort_by=${sortBy}&order=${order}`));
    } else {
      nav.push(Markup.button.callback(' ', 'noop'))
    }
    if (page < totalPages) {
      nav.push(Markup.button.callback('Next »', `token_list?page=${page + 1}&sort_by=${sortBy}&order=${order}`));
    } else {
      nav.push(Markup.button.callback(' ', 'noop'))
    }
  }

  rows.push(nav)

  // Add sorting buttons
  rows.push([
    Markup.button.callback("Most shilled", `token_list?page=${page}&sort_by=${SORTING.SHILL}&order=${ORDER.DSC}`),
    Markup.button.callback("Recent first", `token_list?page=${page}&sort_by=${SORTING.LAST_MENTION}&order=${ORDER.ASC}`),
    Markup.button.callback("Alphabetical", `token_list?page=${page}&sort_by=${SORTING.NAME}&order=${ORDER.ASC}`),
  ])

  return Markup.inlineKeyboard(rows);
};

export async function getCollection(client: MongoClient) {
  const db = client.db(DB_NAME);
  const hasCollection = (await db.listCollections({}, { nameOnly: true }).toArray())
    .some(c => c.name === COLLECTION_NAME)

  // Check if the collection exists and create it with the schema if it doesn't
  if (!hasCollection) {
    const newCollection = await db.createCollection<Data>(COLLECTION_NAME/* , {
        validator: dataSchema
      } */);
    console.log(`Collection ${COLLECTION_NAME} created with schema validation`);
    return newCollection
  } else {
    return db.collection<Data>(COLLECTION_NAME)
  }
}

/**
 * Swallow the error if this is caused by "message is not modified" or propage the error otherwise
 */
export function editMessageText(ctx: Context, text: string | FmtString, extra?: ExtraEditMessageText) {
  ctx.editMessageText(text, extra)
    .catch(e => console.error("SAME_MESSAGE", e))
}

export function getShilledTime(date: Date) {
  const now = Date.now()
  if (now - date.getTime() <= 24 * 3600 * 1000) {// if shilled today
    // Display hour
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
  })
  }
  return '> 24h'
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