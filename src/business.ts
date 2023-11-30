import { MongoClient } from "mongodb";
import { COLLECTION_NAME, DB_NAME, TOKENS_PER_PAGE } from "./constants";
import { Data } from "./types";
import { Context, Markup } from "telegraf";
import { FmtString } from "telegraf/typings/format";
import { ExtraEditMessageText } from "telegraf/typings/telegram-types";
import { NavParams } from "./types";

export function getTickers(message: string) {
    const tickerRegex = /\$([a-zA-Z]+)|\b([A-Z]{2,})\b/g; // Regex pour détecter le ticker
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
  const mostTalkative = project.shillers.reduce<Array<{shiller: string, count: number}>>(function(board, shiller) {
    const row = board.find((row) => row.shiller === shiller)
    if (row) {
      row.count++
    } else {
      board.push({shiller, count: 1})
    }
    return board
  }, [])
  .sort((a, b) => b.count - a.count)[0].shiller

  return `Information for token: ${ticker}:
  - shilled: ${project.messages.length} times in the group
  - first shilled by: @${firstMessage.author}
  - more talkative: @${mostTalkative}
  - first message: ${firstMessage.url}
`;
}

/**
 * Helper function to create inline keyboard buttons for tokens
 */
export async function createTokenButtons(client: MongoClient, { page, sortBy, order }: NavParams) {
  const collection = await getCollection(client)
  const noProject = await collection.countDocuments()
  const paginatedProjects = await collection.find().skip(TOKENS_PER_PAGE * (page - 1)).limit(TOKENS_PER_PAGE).toArray()

  const tokenButtons = paginatedProjects.map(project => Markup.button.callback(project.ticker, `info?ticker=${project.ticker}&page=${page}&sort_by=${sortBy}&order=${order}`));
  const rows = []
  const btPerRow = 3
  const noRows = Math.ceil(tokenButtons.length / btPerRow)
  for (let i = 0; i < noRows; i++) {
    const row = []
    for (let j= 0; j < btPerRow; j++) {
        row.push(tokenButtons[i*btPerRow + j] ?? Markup.button.callback(' ', 'noop'))
    }
    rows.push(row);
  }

  // Add navigation buttons if needed
  const totalPages = Math.ceil(noProject / TOKENS_PER_PAGE);
  const nav = []
  if (totalPages > 1) {
    if (page > 1) {
      nav.push(Markup.button.callback('« Prev', `token_list?page=${page - 1}`));
    }
    if( page < totalPages) {
      nav.push(Markup.button.callback('Next »', `token_list?page=${page + 1}`));
    }
  }

  rows.push(nav)

  // Add sorting buttons
  rows.push([
    Markup.button.callback("Last shilled first", `token_list?page=${page}`)
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