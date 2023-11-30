import { MongoClient } from "mongodb";
import { COLLECTION_NAME, DB_NAME, TOKENS_PER_PAGE } from "./constants";
import { Data } from "./types";
import { Markup } from "telegraf";

export function getTickers(message: string) {
    const tickerRegex = /\$([a-zA-Z]+)|\b([A-Z]{2,})\b/g; // Regex pour détecter le ticker
    const tickers = message.match(tickerRegex) ?? [];
    return Array.from(tickers).map(ticker => ticker.replace('$', '').toUpperCase());
}

export async function getTokenInfos(client: MongoClient, ticker: string) {
  const collection = await getCollection(client)
  // How many times it was shilled
  const count = await collection.countDocuments({ticker: { $eq: ticker }} )
  return `Information for token: ${ticker}:
  - shilled: ${count} times in the group
`;
}

/**
 * Helper function to create inline keyboard buttons for tokens
 */
export async function createTokenButtons(client: MongoClient, currentPage: number) {
  const collection = await getCollection(client)
  const noProject = await collection.countDocuments()
  const paginatedProjects = await collection.find().skip(TOKENS_PER_PAGE * (currentPage - 1)).limit(TOKENS_PER_PAGE).toArray()

  const buttons = paginatedProjects.map(project => Markup.button.callback(project.ticker, `info_${project.ticker}`));

  // Add navigation buttons if needed
  const totalPages = Math.ceil(noProject / TOKENS_PER_PAGE);
  if (totalPages > 1) {
    if (currentPage > 1) {
      buttons.push(Markup.button.callback('« Prev', `token_list_page_${currentPage - 1}`));
    }
    if( currentPage < totalPages) {
      buttons.push(Markup.button.callback('Next »', `token_list_page_${currentPage + 1}`));
    }
  }

  return Markup.inlineKeyboard(buttons);
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