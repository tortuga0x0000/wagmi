import * as dotenv from 'dotenv'
import { MongoClient } from 'mongodb';
import { Context, Markup, Telegraf } from 'telegraf'
import { message } from 'telegraf/filters'
import { createTokenButtons, editMessageText, getCollection, getMessageURL, getTickers, getTokenInfos, toOrder, toSorting, formatDate, isDate, addReminder, checkTicker, startReminders, startReminder, isPrivateChat, continueCallConversation, getConfig, addCategories, createConfigIfNotExists, removeCategories, removeCallFromProject, parseTelegramPrivateGroupMessageUrl } from './business';
import { DB_NAME } from './constants';
import { SORTING, ORDER, ROUTE, DataDoc, COLLECTION_NAME, CallConversation, CallConversationState } from './types';
import { Update, Message } from 'telegraf/typings/core/types/typegram';
import { doesBelongsToGroup } from './business';

dotenv.config(process.env.NODE_ENV === "production" ? { path: __dirname + '/.env' } : undefined);

// Connection URL with username and password
const username = process.env.DB_USER && encodeURIComponent(process.env.DB_USER);
const password = process.env.DB_PWD && encodeURIComponent(process.env.DB_PWD);

// Connection URL
const url = `mongodb://${username}:${password}@localhost:27017/${DB_NAME}?authSource=${DB_NAME}`

const client = new MongoClient(url);

const bot = new Telegraf(process.env.TG_BOT_ID!);

bot.start(async function(ctx) {
  if(!isPrivateChat(ctx)) {
    replyNoop(ctx)
    return;
  }
  ctx.reply(`
Hello ${ctx.from.username},
I am your new assistant to help you organize the information of your favorite group. I capture messages of the group as soon I read a $TOKEN or $token. So be careful how do you write it.

You can control me with:
- /list to display a list of all projects which has been shilled.
- /call to add a call in the call topic
- /remind to send you a programmed DM about a ticker at a specific date.
  - The date needs to be in UTC
  - You can provide a specific note (optional)
  - Eg: /remind BTC ${formatDate(new Date(Date.now() + 3600000))} buy some BTC
  `,)
})

// Command to list all tokens
bot.command('list', async function (ctx) {
  if(!isPrivateChat(ctx)) {
    replyNoop(ctx);
    return;
  }
  try {
    if(!process.env.CHAT_ID || !await doesBelongsToGroup(bot, ctx.from, process.env.CHAT_ID)) {
      replyNoAuth(ctx);
      return
    }
  } catch(e) {
    ctx.reply('Error checking group membership.');
  }
  const buttons = await createTokenButtons(client, { page: 1, sortBy: SORTING.LAST_MENTION, order: ORDER.DSC });
  ctx.reply('Select a token:', buttons);
});
bot.command('remind', async function (ctx) {
  if(!isPrivateChat(ctx)) {
    replyNoop(ctx);
    return;
  }
  try {
    if(!process.env.CHAT_ID || !await doesBelongsToGroup(bot, ctx.from, process.env.CHAT_ID)) {
      replyNoAuth(ctx);
      return
    }
  } catch(e) {
    ctx.reply('Error checking group membership.');
  }
  // Setup a reminder for a specific ticker
  const args = ctx.message.text.match(/^\/remind ([A-Z\d]+)\s(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2})(\s.+)?/)
  if (args) {
    const user = ctx.message.from.username
    const ticker = args[1]
    const date = args[2]
    const note = args[3]?.trim()
    if (!isDate(date)) {
      ctx.reply(`Argument are not correct, please ensure:
      - of the order or the command arguments
      - to provide a complete date YYYY-MM-DD HH-mm in the 24h notation
      - to provide a date at UTC timezone
      
      Eg: /remind BTC ${formatDate(new Date())} buy some BTC`
      )
    } else if (!await checkTicker(client, ticker)) {
      ctx.reply(`Ticker ${ticker} has not been shilled yet. You can't set a reminder for it.`)
    } else if (user && date && ticker) {
      const timestamp = new Date(date + ' UTC').getTime() 
      if (timestamp <= Date.now()) {
        ctx.reply(`Please provide a date in the future.`)
      } else { 
        const data = {
          chatId: ctx.message.chat.id,
          ticker,
          date: timestamp,
          note
        }
        const id = await addReminder(
          client,
          data
        )
        startReminder(bot, client, {
            _id: id.insertedId,
            ...data,
          }
        ) 
        ctx.reply(`Reminder set to the ${date} UTC`)
      }
    }
  }
})

bot.command('config', async function (ctx) {
  const isFromPrivateChat = isPrivateChat(ctx)
  
  // Setup a reminder for a specific ticker
  if (ctx.message.from.username !== "tortuga0x0000") {
    ctx.reply('Only @tortuga0x0000 can configure it for now.')
    return
  }
  const args = ctx.message.text.match(/^\/config( \d+)? (categories) (add|remove) (.*)/)
  if (args) {
    const groupId = isFromPrivateChat ? Number(args[1]) : Number(ctx.chat.id.toString().slice(4))

    createConfigIfNotExists(client, groupId)

    const section = args[2]
    const subCommand = args[3]

    if (section === "categories") {
      if (subCommand === "add") {
        const categories = args[4]?.toLocaleLowerCase().split(' ')
        if (categories.length) {
          addCategories({ client, groupId, categories })
        }
      } else if (subCommand === "remove") {
        const categories = args[4]?.split(' ')
        if (categories.length) {
          removeCategories({ client, groupId, categories })
        }
      }
    }
  }
})

let callConversations: Map<number, CallConversation> = new Map();

bot.command('call', async (ctx) => {
  if(!isPrivateChat(ctx)) {
    replyNoop(ctx);
    return;
  }
  try {
    if(!process.env.CHAT_ID || !await doesBelongsToGroup(bot, ctx.from, process.env.CHAT_ID)) {
      replyNoAuth(ctx);
      return
    }
  } catch(e) {
    ctx.reply('Error checking group membership.');
  }
  const chatId = ctx.chat.id;
  const conversation = { step: CallConversationState.new }
  callConversations.set(chatId, conversation as any) // FIX: tagged type

  ctx.reply("Enter the ticker:")
})

bot.command('delete_call', async (ctx) => {
  // Setup a reminder for a specific ticker
  if(!isPrivateChat(ctx)) {
    replyNoop(ctx);
    return;
  }
  if (ctx.message.from.username !== "tortuga0x0000") {
    ctx.reply('Only @tortuga0x0000 can delete for now.')
    return
  }
  const args = ctx.message.text.match(/^\/delete_call (.+)/)
  if (args && args.length) {
    const messageUrls = args[1].split(' ')
    for (const url of messageUrls) {
      const parsedUrl = parseTelegramPrivateGroupMessageUrl(url)
      if (parsedUrl) {
        bot.telegram.deleteMessage(parsedUrl.chatId, parsedUrl.messageId).catch(e => {
          console.error(e)
          ctx.reply(`Message ${url} to delete not found`)
        })
        await removeCallFromProject(client, parsedUrl.messageId)
      }
      
    }
    
  }
})

// Handling info
bot.action(new RegExp(`(${ROUTE.info}\\?)(.+)`), async function (ctx) { // Note the double \\ to escape the ? because we use a template litteral
  // Parse the query payload
  const queryParams = new URLSearchParams(ctx.match[2])
  const { page, sortBy, order } = getNavParams(queryParams);

  const ticker = queryParams.get('t');
  if (ticker) {
    editMessageText(
      ctx,
      await getTokenInfos(client, ticker),
      Markup.inlineKeyboard([
        [Markup.button.callback('Back to List', `${ROUTE.token_list}?p=${page}&s=${sortBy}&o=${order}`)]
      ])
    );
  }
});

// Handling pagination
bot.action(new RegExp(`(${ROUTE.token_list}\\?)(.+)`), async (ctx) => {
  // Parse the query payload
  const queryParams = new URLSearchParams(ctx.match[2])

  const { page, sortBy, order } = getNavParams(queryParams);
  const markup = await createTokenButtons(client, { page, sortBy, order });
  editMessageText(ctx, 'Select a token:', markup);
});

// Display reminders for a token
bot.action(new RegExp(`(${ROUTE.reminders}\\?)(.+)`), async (ctx) => {
  // Parse the query payload
  const queryParams = new URLSearchParams(ctx.match[2])

  const { page, sortBy, order } = getNavParams(queryParams);
})

bot.on(message('photo'), ctx => {
  const callConversation = callConversations.get(ctx.chat.id);
  if (callConversation) {
    continueCallConversation({ bot, client, ctx, conversation: callConversation, conversations: callConversations })
  }
  if (ctx.message.message_thread_id?.toString() === process.env.CALL_CHAN) {
    ctx.deleteMessage(ctx.message.message_id)
  }
})

// WARNING: always declare this handler last otherwise it will swallow the bot commands
bot.on(message('text'), async function (ctx) {
  // Guess the intent
  const callConversation = callConversations.get(ctx.chat.id);
  if (callConversation) {
    continueCallConversation({ bot, client, ctx, conversation: callConversation, conversations: callConversations })
  }

  if (ctx.message.message_thread_id?.toString() === process.env.CALL_CHAN) {
    ctx.deleteMessage(ctx.message.message_id)
  }

  // Add some new projects shilled in group chat
  if (ctx.message.chat.type !== "private") {
    const message = ctx.message.text

    //TEMP just for "forward" feature experimentation
    //TODO limit forwarding to message with original chat id.
    const isForwarded = !!ctx.message.forward_from
    const author = isForwarded
      ? ctx.message.forward_from?.username
      : ctx.from.username

    if (!message || !author) {
      return
    }

    const tickers = getTickers(message);
    const date = ctx.message.date
    const messageURL = getMessageURL(ctx)

    for (const ticker of tickers) {
      const collection = await getCollection<DataDoc>(client, COLLECTION_NAME.data)
      const item = await collection.findOne({ ticker })

      if (item && author) {
        item.shillers.push(author)
        item.messages.push({ url: messageURL, content: message, author, date })
        collection.replaceOne({ _id: item._id }, item)

      } else if (author) {
        await collection.insertOne({
          ticker,
          shillers: [author],
          messages: [{ url: messageURL, content: message, author, date }]
        })
      }
    }
  }
});

bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}`, err);
});

function replyNoop(ctx: Context<{
  message: Update.New & Update.NonChannel & Message.TextMessage;
  update_id: number;
}>) {
  ctx.reply(`Please use this command in private chat with @${ctx.botInfo.username}`);
}


function replyNoAuth(ctx: Context<{
  message: Update.New & Update.NonChannel & Message.TextMessage;
  update_id: number;
}>) {
  ctx.reply('You are not allowed to use this bot.');
}

function getNavParams(queryParams: URLSearchParams) {
  const page = Number(queryParams.get('p'));
  const sortBy = queryParams.get('s');
  const order = queryParams.get('o');
  return { page, sortBy: toSorting(Number(sortBy)), order: toOrder(order) };
}


async function main() {
  await client.connect();
  console.log('Connected to MongoDB');
  // Restart the reminders timeout
  startReminders(client, bot)
  await bot.launch();
  // https://github.com/telegraf/telegraf/issues/1749 the launch function never resolve. Any code below will never be executed.
}

main().catch(console.error);

// In case of unexcepted close of the Node.js process
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
