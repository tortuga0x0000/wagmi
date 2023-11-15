import * as dotenv from 'dotenv'
import { MongoClient } from 'mongodb';
import { GoogleSpreadsheet } from 'google-spreadsheet'
import { JWT } from 'google-auth-library';
import { Telegraf } from 'telegraf'
import { Data } from './types'

dotenv.config(process.env.NODE_ENV === "production" ? {path: __dirname + '/.env'} : undefined);

// Connection URL with username and password
const username = process.env.WAGMI_USER && encodeURIComponent(process.env.WAGMI_USER);
const password = process.env.DB_PWD && encodeURIComponent(process.env.DB_PWD);
const dbName = 'wagmi-db';
const collectionName = 'MetaquantDAO'; // Your collection name

// Connection URL
const url = process.env.NODE_ENV === "production"
  ? `mongodb://${username}:${password}@localhost:27017/${dbName}`
  : 'mongodb://localhost:27017'

const client = new MongoClient(url);

const jwt = new JWT({
  email: process.env.CLIENT_EMAIL,
  key: process.env.PRIVATE_KEY!.split(String.raw`\n`).join('\n'),
  scopes:['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'],
});

const doc = new GoogleSpreadsheet('1VP0JAbHjF5uyIkU3Fzx_P4rFb4C3dcZ8h6_ICX-vBrI', jwt);

async function authGoogleSheets() {
    await doc.loadInfo()
    console.info("Auth OK")
}

const bot = new Telegraf(process.env.TG_BOT_ID!);

bot.on('text', async (ctx) => {
    const message = ctx.message.text;
    const tickerRegex = /\$[a-zA-Z]+/g; // Regex pour détecter le ticker
    const tickers = message.match(tickerRegex) ?? []

      const author = ctx.from.username
  const date = ctx.message.date
        const groupName = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup' ? ctx.chat.title : 'PRIVATE_GROUP';
        const messageURL = `https://t.me/${groupName}/${ctx.message.message_id}`;
      

  for (const ticker of tickers) {
    const collection = await getCollection()
    const item = await collection.findOne({ ticker })

    if (item && author) {
      item.shillers.push(author)
      item.messages.push({url: messageURL, content: message, author, date })
      collection.replaceOne({_id: item._id}, item)

    } else if (author) {
      await collection.insertOne({
        ticker,
        shillers: [author],
        messages: [{ url: messageURL, content: message, author, date }]
      })

          ctx.reply(`Ticker ${ticker} add to our database`);
      }
    }
}); 


async function getCollection() {
  const db = client.db(dbName);
  const hasCollection = (await db.listCollections({ collectionName }, { nameOnly: true }).toArray())
    .some(c => c.name === collectionName)

  // Check if the collection exists and create it with the schema if it doesn't
  if (!hasCollection) {
    const newCollection = await db.createCollection<Data>(collectionName/* , {
      validator: dataSchema
    } */);
    console.log(`Collection ${collectionName} created with schema validation`);
    return newCollection
  } else {
    return db.collection<Data>(collectionName)
  }
}

async function main() {
  await client.connect();
  console.log('Connected to MongoDB');
  await authGoogleSheets();
  bot.launch();
}

main().catch(console.error);

// In case of unexcepted close of the Node.js process
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
