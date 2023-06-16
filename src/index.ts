import TelegramBot from 'node-telegram-bot-api';

require('dotenv').config()

const HTTP_API_TOKEN = process.env["HTTP_API_TOKEN"];

if (!HTTP_API_TOKEN) {
    throw new Error("Need to set a .env file with HTTP_API_TOKEN as the TG bot token")
}

const bot = new TelegramBot(HTTP_API_TOKEN, {polling: true});