import { MongoClient } from "mongodb";
import { COLLECTION_NAME, DB_NAME } from "./constants";
import { Data } from "./types";
import { InlineKeyboardButton } from "telegraf/typings/core/types/typegram";
import { Markup } from "telegraf";

export function getTickers(message: string) {
    const tickerRegex = /\$([a-zA-Z]+)|\b([A-Z]{2,})\b/g; // Regex pour détecter le ticker
    const tickers = message.match(tickerRegex) ?? [];
    return Array.from(tickers).map(ticker => ticker.replace('$', '').toUpperCase());
}


/**
 * Helper function to create inline keyboard buttons for tokens
 */
export async function createTokenButtons(client: MongoClient): Promise<InlineKeyboardButton[]> {
  const collection = await getCollection(client)
  return collection.find().map(project => Markup.button.callback(project.ticker, `info_${project.ticker}`)).toArray();
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