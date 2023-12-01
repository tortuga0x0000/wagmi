import * as dotenv from 'dotenv'
import { MongoClient } from 'mongodb';
import { Markup, Telegraf } from 'telegraf'
import { message } from 'telegraf/filters'
import { createTokenButtons, editMessageText, getCollection, getMessageURL, getTickers, getTokenInfos } from './business';
import { DB_NAME } from './constants';
import { SORTING, ORDER } from './types';

dotenv.config(process.env.NODE_ENV === "production" ? { path: __dirname + '/.env' } : undefined);

// Connection URL with username and password
const username = process.env.DB_USER && encodeURIComponent(process.env.DB_USER);
const password = process.env.DB_PWD && encodeURIComponent(process.env.DB_PWD);

// Connection URL
const url = `mongodb://${username}:${password}@localhost:27017/${DB_NAME}?authSource=${DB_NAME}`

const client = new MongoClient(url);

const bot = new Telegraf(process.env.TG_BOT_ID!);

// Command to list all tokens
bot.command('list', async function(ctx) {
  const buttons = await createTokenButtons(client, {page: 1, sortBy: SORTING.LAST_MENTION, order: ORDER.DSC});
  ctx.reply('Select a token:', buttons);
});

// Handling callback queries
bot.action(/(info\?)(.+)/, async function(ctx) {
  // Parse the query payload
  const queryParams = new URLSearchParams(ctx.match[2])
  const { page, sortBy, order } = getNavParams(queryParams);

  const ticker = queryParams.get('ticker');
  if (ticker) {
    editMessageText(
      ctx,
      await getTokenInfos(client, ticker),
      Markup.inlineKeyboard([Markup.button.callback('Back to List', `token_list?page=${page}&sort_by=${sortBy}&order=${order}`)])
    );
  }
});

// Handling pagination
bot.action(/(token_list\?)(.+)/, async (ctx) => {
  // Parse the query payload
  const queryParams = new URLSearchParams(ctx.match[2])

  const { page, sortBy, order } = getNavParams(queryParams);
  const markup = await createTokenButtons(client, { page, sortBy, order });
  editMessageText(ctx, 'Select a token:', markup);
});

// WARNING: always declare this handler last otherwise it will swallow the bot commands
bot.on(message('text'), async function(ctx) {
  // Check if the message is a command and skip processing if it is
  if (ctx.message.text.startsWith('/')) {
    return;
  }
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
    const collection = await getCollection(client)
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
});

function getNavParams(queryParams: URLSearchParams) {
  const page = Number(queryParams.get('page'));
  const sortBy = queryParams.get('sort_by') as SORTING ?? SORTING.LAST_MENTION;
  const order = queryParams.get('order') as ORDER ?? ORDER.DSC;
  return { page, sortBy, order };
}

async function main() {
  await client.connect();
  console.log('Connected to MongoDB');
  bot.launch();
}

main().catch(console.error);

// In case of unexcepted close of the Node.js process
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
