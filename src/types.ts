import { Document, ObjectId } from "mongodb";

export enum ORDER {
    ASC = 1,
    DSC = -1,
}

export enum SORTING {
  SHILL,
  LAST_MENTION,
  NAME
}

export enum ROUTE {
  token_list,
  info,
  reminders,
}

export enum COLLECTION_NAME {
  data = "data",
  reminders = "reminders",
  config = "config",
}

export type NavParams = { page: number, sortBy: SORTING, order: ORDER }

/* eslint-disable */
/**
 * This file was automatically generated by json-schema-to-typescript.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
 * and run json-schema-to-typescript to regenerate this file.
 */

export interface DataDoc {
    /**
     * Unique token ticker for indexing
     */
    ticker: string;
    shillers: string[];
    /**
     * The call links
     */
    callURLs?: string[];
    /**
     * Array of message objects
     */
    messages: {
      /**
       * Must be a string and is required
       */
      url: string;
      /**
       * UTC date of the message. Required.
       */
      date: number;
      /**
       * Must be a string and is required
       */
      content: string;
      /**
       * Must be a string and is required
       */
      author: string;
      [k: string]: unknown;
    }[];
    [k: string]: unknown;
  }

export interface ReminderDoc {
  chatId: number
  /**
   * UTC
   */
  date: number
  ticker: string
  note?: string
}

export interface Reason {
  text: string
  photo?: string
}

export interface Call {
  author: string
  ticker: string
  reason: Reason
  entries: string[]
  sl: string
  targets: string[]
}

export enum CallConversationState {
  new,
  ticker,
  categories,
  reason,
  type,
  entry,
  exit,
  stopLoss,
}

export enum CallType {
  long = "long",
  short = "short",
}

export type CallConversation =
| {
  step: CallConversationState.new
}
| {
  step: CallConversationState.ticker
  data: { ticker: string }
}
| {
  step: CallConversationState.categories
  data: { 
    ticker: string
    categories: string[]
  }
}| {
  step: CallConversationState.reason
  data: { 
    ticker: string
    categories: string[]
    reason: Reason
  }
}
| {
  step: CallConversationState.type
  data: {
    ticker: string
    categories: string[]
    reason: Reason
    type: CallType | null
  }
}
| {
  step: CallConversationState.entry
  data: {
    ticker: string
    categories: string[]
    reason: Reason
    type: CallType | null
    entries: string[] | null
  }
}
| {
  step: CallConversationState.exit
  data: {
    ticker: string
    categories: string[]
    reason: Reason
    type: CallType | null
    entries: string[] | null
    targets: string[] | null
  }
}
| {
  step: CallConversationState.stopLoss
  data:{
    ticker: string
    categories: string[]
    reason: Reason
    type: CallType | null
    entries: string[] | null
    targets: string[] | null
    stopLoss: string
  }
}

export interface Config {
  groupId: number
  categories: string[]
}