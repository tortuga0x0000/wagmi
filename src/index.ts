import * as dotenv from 'dotenv'
import { MongoClient } from 'mongodb';
import { Markup, Telegraf } from 'telegraf'
import { message } from 'telegraf/filters'
import { createTokenButtons, editMessageText, getCollection, getMessageURL, getTickers, getTokenInfos, toOrder, toSorting, formatDate, isDate, addReminder, hasTicker, startReminders, startReminder, checkTickers } from './business';
import { CoinGeckoService } from './services'
import { DB_NAME } from './constants';
import { SORTING, ORDER, ROUTE, DataDoc, COLLECTION_NAME } from './types';

dotenv.config(process.env.NODE_ENV === "production" ? { path: __dirname + '/.env' } : undefined);

// Connection URL with username and password
const username = process.env.DB_USER && encodeURIComponent(process.env.DB_USER);
const password = process.env.DB_PWD && encodeURIComponent(process.env.DB_PWD);

// Connection URL
const url = `mongodb://${username}:${password}@localhost:27017/${DB_NAME}?authSource=${DB_NAME}`

const client = new MongoClient(url);

const bot = new Telegraf(process.env.TG_BOT_ID!);

bot.start(async function(ctx) {
  ctx.reply(`
Hello ${ctx.from.username},
I am your new assistant to help you organize the information of your favorite group. I capture messages of the group as soon I read a $TOKEN or $token. So be careful how do you write it.

You can control me with:
- /list to display a list of all projects which has been shilled.
- /remind to send you a programmed DM about a ticker at a specific date.
  - The date needs to be in UTC
  - You can provide a specific note (optional)
  - Eg: /remind BTC ${formatDate(new Date(Date.now() + 3600000))} buy some BTC
  `)
})

// Command to list all tokens
bot.command('list', async function (ctx) {
  if (ctx.chat.type !== 'private') {
    ctx.reply('Please use this command in private chat.');
    return;
  }
  const buttons = await createTokenButtons(client, { page: 1, sortBy: SORTING.LAST_MENTION, order: ORDER.DSC });
  ctx.reply('Select a token:', buttons);
});
/* \$(?![0-9]+([kKmMbBtT][nN]?[sS]?)?\b)(?!(0[xX][a-fA-F0-9]{40})\b)[a-zA-Z0-9]+ */
bot.command('remind', async function (ctx) {
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
    } else if (!await hasTicker(client, ticker)) {
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

// WARNING: always declare this handler last otherwise it will swallow the bot commands
bot.on(message('text'), async function (ctx) {
  // Guess the intent

  // Add some new projects shilled in group chat
  if (ctx.message.chat.type !== "private" || ctx.message.from.username === "tortuga0x0000") {
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
    const toCheck: string[] = []

    for (const ticker of tickers) {
      const collection = await getCollection<DataDoc>(client, COLLECTION_NAME.data)
      const item = await collection.findOne({ ticker })

      if (item && author) {
        item.shillers.push(author)
        item.messages.push({ url: messageURL, content: message, author, date })
        collection.replaceOne({ _id: item._id }, item)

      } else {
        if (author) {
          toCheck.push(ticker)
        }
      }
      
      // Check all the new ticker
      (await checkTickers(toCheck))
        .forEach(async function(newTicker){
          await collection.insertOne({
            ticker: newTicker,
            shillers: [author],
            messages: [{ url: messageURL, content: message, author, date }]
          })
        })
    }
  }
});

bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}`, err);
});

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
  // Start services
  if (!await CoinGeckoService.start()) {
    console.error("start failed: coin gecko")
  }
  await bot.launch();
  // https://github.com/telegraf/telegraf/issues/1749 the launch function never resolve. Any code below will never be executed.
}

main().catch(console.error);

// In case of unexcepted close of the Node.js process
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
