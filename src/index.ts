import * as dotenv from 'dotenv'
import { MongoClient } from 'mongodb';
import { Markup, Telegraf } from 'telegraf'
import { message } from 'telegraf/filters'
import { createTokenButtons, getCollection, getTickers, getTokenInfos } from './business';
import { DB_NAME } from './constants';

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
  const buttons = await createTokenButtons(client);
  ctx.reply('Select a token:', Markup.inlineKeyboard(buttons));
});

// Handling callback queries
bot.action(/info_.+/, async function(ctx) {
  const ticker = ctx.match[0].split('_')[1];
  ctx.editMessageText(
    await getTokenInfos(client, ticker),
    Markup.inlineKeyboard([Markup.button.callback('Back to List', 'back_to_list')])
  );
});

bot.action("back_to_list", async function(ctx) {
  const buttons = await createTokenButtons(client);
  ctx.editMessageText('Select a token:', Markup.inlineKeyboard(buttons))
})

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
  const groupName = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup' ? ctx.chat.title : 'PRIVATE_GROUP';
  const messageURL = `https://t.me/${groupName}/${ctx.message.message_id}`;

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

async function main() {
  await client.connect();
  console.log('Connected to MongoDB');
  bot.launch();
}

main().catch(console.error);

// In case of unexcepted close of the Node.js process
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
