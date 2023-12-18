import { MongoClient, ObjectId, WithId } from "mongodb";
import { DB_NAME, NA_ANSWER, NA_VALUE, TOKENS_PER_PAGE } from "./constants";
import { ROUTE, COLLECTION_NAME, DataDoc, ORDER, ReminderDoc, SORTING, CallConversation, CallConversationState, CallType, Config } from "./types";
import { Context, Markup, NarrowedContext, Telegraf } from "telegraf";
import { FmtString } from "telegraf/typings/format";
import { ExtraEditMessageText } from "telegraf/typings/telegram-types";
import { NavParams } from "./types";
import { CallbackQuery, Message, Update } from "telegraf/typings/core/types/typegram";

const remindersTimeoutHandlers: TimerHandler[] = []

const tickerRegex = /\$(?![0-9]+([kKmMbB][sS]?)?\b)(?!(0[xX][a-fA-F0-9]{40})\b)[a-zA-Z0-9]+/gm; // Ticker regex

export function getTickers(message: string) {
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

  return `
Information for token: ${ticker}:
${project.callURLs?.length ? `
- call: ${project.callURLs.join(' ')}` : ''}
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

/*
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

export async function getCollection<T extends DataDoc | ReminderDoc | Config>(client: MongoClient, collectionName: COLLECTION_NAME) {
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

/*
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

export async function addReminder(client: MongoClient, { chatId, ticker, date, note }: { chatId: number, ticker: string, date: number, note?: string }) {
  const reminders = await getCollection<ReminderDoc>(client, COLLECTION_NAME.reminders)

  return reminders.insertOne({
    chatId,
    ticker,
    date,
    note
  })
}

export async function checkTicker(client: MongoClient, ticker: string) {
  const collection = await getCollection<DataDoc>(client, COLLECTION_NAME.data)
  const project = await collection.findOne({ ticker })
  return !!project
}

export async function startReminders(client: MongoClient, bot: Telegraf<Context<Update>>) {
  const collection = await getCollection<ReminderDoc>(client, COLLECTION_NAME.reminders)
  const reminders = await collection.find().toArray()
  reminders.forEach(function (reminder) {
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
      collection.findOneAndDelete({ _id: reminder._id })
    }, timeout);
  }
}

export function isPrivateChat(ctx: { chat?: { type: string } } & Context<Update>) {
  return ctx.chat?.type === 'private'
}

export async function continueCallConversation(
  {
    bot,
    client,
    ctx,
    conversation,
    conversations
  }: {
    bot: Telegraf;
    client: MongoClient
    ctx: 
      | NarrowedContext<Context<Update>, Update.MessageUpdate<Record<"text", {}> & Message.TextMessage>>
      | NarrowedContext<Context<Update>, Update.MessageUpdate<Record<"photo", {}> & Message.PhotoMessage>>
    conversation: CallConversation
    conversations: Map<number, CallConversation>
  }) {
  switch (conversation.step) {
    case CallConversationState.new:
      // Condition
      if (isText(ctx) && isValidTicker(ctx.message.text)) {
        // Mutation
        conversations.set(ctx.chat.id, {
          step: CallConversationState.ticker,
          data: { ticker: getTicker(ctx.message.text)?.[0].toUpperCase()! } // FIXME: non null assertion
        })
        const existingCategories = (await getConfig(client, Number(process.env.CHAT_ID!)))?.categories ?? []
        // Reaction
        ctx.reply(`Enter the narratives from the following list, separated with a space:\n${existingCategories.map(c => `\n - ${c}`).join('')}`);

      } else {
        ctx.reply(`Please check the ticker format:
          - can start with $
          - can contains lower case or uppercase and numbers
          - must be only ONE word`
        );
      }
      break;
    case CallConversationState.ticker:
      // Condition
      if (isText(ctx)) {
        const inputCategories = ctx.message.text.toLocaleLowerCase().split(' ')
        const existingCategories = (await getConfig(client, Number(process.env.CHAT_ID!)))?.categories ?? []
        const validatedCategories = inputCategories.filter(c => existingCategories.includes(c))
        if (validatedCategories.length === inputCategories.length) {
          conversations.set(ctx.chat.id, {
            step: CallConversationState.categories,
            data: { ...conversation.data, categories: validatedCategories }
          })
          // Reaction
          ctx.reply('Enter the reason of the call:');
        } else {
          ctx.reply('Some categories are not part of the available list.')
          ctx.reply(`Please, enter the narratives from the following list, separated with a space:\n${existingCategories.map(c => `\n - ${c}`).join('')}`);
        }
      }
      break;
    case CallConversationState.categories:
      // Condition
      const text = isText(ctx) ? ctx.message.text : ctx.message.caption
      const photo = isPhoto(ctx) ? ctx.message.photo.at(-1)?.file_id : undefined
      if (text?.length) {
        conversations.set(ctx.chat.id, {
          step: CallConversationState.reason,
          data: { ...conversation.data, reason: { text, photo } }
        })
        // Reaction
        ctx.reply('Enter the type of call ("long" or "short") or "NA" to skip:');
      } else {
        ctx.reply('Please enter a reason for the call.')
      }
      break;
    case CallConversationState.reason:
      // Condition
      if (isText(ctx)) {
        const type = ctx.message.text.toUpperCase() === NA_ANSWER ? NA_VALUE : ctx.message.text
        if (type === NA_VALUE || isCallType(type)) {
          // Mutation
          conversations.set(ctx.chat.id, {
            step: CallConversationState.type,
            data: { ...conversation.data, type: type }
          })
          // Reaction
          ctx.reply('Enter the price entry, separated with a space if multiple entries (eg: "12" or "12 12.5") or "NA" to skip:')
        } else {
          ctx.reply('Wrong format, type "long" or "short" or "NA" to skip:')
        }
      } else {
        ctx.reply('Send only text.')
      }
      break;
    case CallConversationState.type:
      if (isText(ctx)) {
        const entries = getNumbers(ctx.message.text)
        if (entries?.length || entries === NA_VALUE) {
          conversations.set(ctx.chat.id, {
            step: CallConversationState.entry,
            data: { ...conversation.data, entries }
          })
          ctx.reply('Enter the price level for exit, separated with a space in case of multiple TPs (eg: "12" or "12 12.5") or "NA" to skip:');
        } else {
          ctx.reply('Wrong format, try again (eg: "12" or "12 12.5") or "NA" to skip:')
        }
      } else {
        ctx.reply('Send only text.')
      }
      break;
    case CallConversationState.entry:
      if (isText(ctx)) {
        const targets = getNumbers(ctx.message.text)
        if (targets?.length || targets === NA_VALUE) {
          conversations.set(ctx.chat.id, {
            step: CallConversationState.exit,
            data: { ...conversation.data, targets }
          })
          ctx.reply('Enter the stop loss level or "NA" to skip:');
        } else {
          ctx.reply('Wrong format, try again (eg: "12" or "12 12.5") or "NA" to skip:');
        }
      } else {
        ctx.reply('Send only text.')
      }
      break;
    case CallConversationState.exit:
      if (isText(ctx)) {
        const sl = getNumbers(ctx.message.text)
        if (sl === NA_VALUE || sl.length === 1) {
          const callMsg = `
  🧐 *Author*: @${escapeMarkdownV2(ctx.message.from.username ?? 'anon')}
  💲 *Symbol*: $${escapeMarkdownV2(conversation.data.ticker)}
  🏷️ *Categories*: ${escapeMarkdownV2(conversation.data.categories.join(' '))}
  💡 *Reason*: ${escapeMarkdownV2(conversation.data.reason.text)}
  ${conversation.data.type !== NA_VALUE
              ? `${conversation.data.type === CallType.long ? '📈' : '📉'} *Type*: ${conversation.data.type}\n`
              : ''}${conversation.data.entries !== NA_VALUE
                ? `🚪 *Entry*: ${escapeMarkdownV2(conversation.data.entries.map(p => `$${p}`).join(' '))}\n`
                : ''}${conversation.data.targets !== NA_VALUE
                  ? `🎯 *Targets*: ${escapeMarkdownV2(conversation.data.targets.map(p => `$${p}`).join(' '))}\n`
                  : ''}${sl !== NA_VALUE
                    ? `🛟 *Stop loss*: $${escapeMarkdownV2(sl[0])}\n`
                    : ''}
            `
          const photo = conversation.data.reason.photo

          const callId = (
            isDefined(photo)
              ? await bot.telegram.sendPhoto(Number(`-100${process.env.CHAT_ID}`), photo, { caption: callMsg, message_thread_id: Number(process.env.CALL_CHAN!), parse_mode: "MarkdownV2" })
              : await bot.telegram.sendMessage(Number(`-100${process.env.CHAT_ID}`), callMsg, { message_thread_id: Number(process.env.CALL_CHAN!), parse_mode: "MarkdownV2" })
            )?.message_id
          // Clean state
          conversations.delete(ctx.chat.id);

          const collection = await getCollection<DataDoc>(client, COLLECTION_NAME.data)
          collection.updateOne({ ticker: conversation.data.ticker.toUpperCase() }, { $addToSet: { callURLs: `https://t.me/c/${process.env.CHAT_ID}/${callId}` } })

          // Reactions
          conversations.delete(ctx.chat.id) // Clean state

          ctx.reply("Call successfully added")
        } else {
          ctx.reply('Please, enter The stop loss level. Just one number (eg: 12.5) or "NA" to skip:');
        }
      } else {
        ctx.reply('Send only text.')
      }
      break;
  }
}

function getTicker(ticker: string) {
  return ticker.match(/(?![0-9]+([kKmMbB][sS]?)?\b)(?!(0[xX][a-fA-F0-9]{40})\b)[a-zA-Z0-9]+/g)
}

function isValidTicker(ticker: string) {
  return getTicker(ticker)?.length === 1
}

function isText(ctx: 
  | NarrowedContext<Context<Update>, Update.MessageUpdate<Record<"text", {}> & Message.TextMessage>>
  | NarrowedContext<Context<Update>, Update.MessageUpdate<Record<"photo", {}> & Message.PhotoMessage>>
): ctx is NarrowedContext<Context<Update>, Update.MessageUpdate<Record<"text", {}> & Message.TextMessage>> {
    return 'text' in ctx.message
}

function isPhoto(ctx: 
  | NarrowedContext<Context<Update>, Update.MessageUpdate<Record<"text", {}> & Message.TextMessage>>
  | NarrowedContext<Context<Update>, Update.MessageUpdate<Record<"photo", {}> & Message.PhotoMessage>>
): ctx is NarrowedContext<Context<Update>, Update.MessageUpdate<Record<"photo", {}> & Message.PhotoMessage>> {
    return 'photo' in ctx.message
}

function getNumbers(msg: string) {
  if (msg.toUpperCase() === NA_ANSWER) {
    return NA_VALUE
  }
  const match = msg.match(/(\d*[.,])?\d+/g)
  return match ? match.slice().map(n => n.replace(',', '.').replace(/^\./, '0.')) : []
}

function isCallType(type: string): type is CallType {
  return type === CallType.long || type === CallType.short
}

export async function createConfigIfNotExists(client: MongoClient, groupId: number) {
  const collection = await getCollection<Config>(client, COLLECTION_NAME.config)
  const config = await collection.findOne({ groupId })
  if (!config) {
    await collection.insertOne({ groupId, categories: [] })
  }
}

export async function getConfig(client: MongoClient, groupId: number) {
  const collection = await getCollection<Config>(client, COLLECTION_NAME.config)
  return await collection.findOne({ groupId })
}

export async function addCategories({ client, groupId, categories }: { client: MongoClient; groupId: number; categories: string[]; }) {
  const collection = await getCollection<Config>(client, COLLECTION_NAME.config)
  await collection.updateOne({ groupId }, { $addToSet: { categories: { $each: categories } } })
}

export async function removeCategories({ client, groupId, categories }: { client: MongoClient; groupId: number; categories: string[]; }) {
  const collection = await getCollection<Config>(client, COLLECTION_NAME.config)
  const existingCategories = (await getConfig(client, groupId))?.categories ?? []
  await collection.updateOne({ groupId }, { $set: { categories: existingCategories.filter(c => !categories.includes(c)) } })
}

export function escapeMarkdownV2(text: string) {
  return text.replace(/[_*[\]()~`>#\+\-|={}.!]/g, '\\$&');
}

export function isDefined<T>(option: T | undefined ): option is T {
  return typeof option !== 'undefined'
}