import * as dotenv from 'dotenv'
import { GoogleSpreadsheet } from 'google-spreadsheet'
import { JWT } from 'google-auth-library';
import { Telegraf } from 'telegraf'
import creds from '../creds.json'

dotenv.config();

enum Header {
  Ticker = "Ticker",
  Messages = "Messages",
  Shillers = "Shillers",
}

const TAB = '_test'

const jwt = new JWT({
  email: creds.client_email,
  key: creds.private_key,
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

    for (const ticker of tickers) {
      await addTickerToSheet(ticker);

      const author = ctx.from.username

      if (author) {
        // Add shiller
        await addShiller(ticker, author)

        // Add msg
        const groupName = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup' ? ctx.chat.title : 'PRIVATE_GROUP';
        const messageURL = `https://t.me/${groupName}/${ctx.message.message_id}`;
        await addMessage(ticker, messageURL, message, author, ctx.message.date)

        ctx.reply(`Ticker ${ticker} ajouté à Google Sheets`);
      }
    }
}); 

async function addMessage(ticker: string, url: string, content: string, author: string, date: number) {
  const sheet = doc.sheetsByTitle[TAB];
  const row = (await sheet.getRows()).find(r => r.get(Header.Ticker) === ticker)
  if (row) {
    // deserialize/serialise message
    const messages: Array<{url: string, content: string, author: string, date: number }> = JSON.parse(row.get(Header.Messages) ?? "[]")
    messages.push({url, content, author, date })
    row.set(Header.Messages, JSON.stringify(messages))
    row.save()
  }
}

async function addShiller(ticker: string, username: string){
  const sheet = doc.sheetsByTitle[TAB];
  const row = (await sheet.getRows()).find(r => r.get(Header.Ticker) === ticker)
  if (row) {
    const shillers = row.get(Header.Shillers)?.split(', ') ?? []
    shillers.push(username)
    row.set(Header.Shillers, shillers.join(', '))
    row.save()
  }
}

async function addTickerToSheet(ticker: string) {
  const sheet = doc.sheetsByTitle[TAB];
  const rows = await sheet.getRows()
  if (!rows.some(row => row.get(Header.Ticker) === ticker)) {
    await sheet.addRow({ Ticker: ticker });
  }
}

async function main() {
  await authGoogleSheets();
  bot.launch();
}

main()

// Pour le cas où Node.js est fermé de manière inattendue
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
