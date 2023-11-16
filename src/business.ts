export function getTickers(message: string) {
    const tickerRegex = /\$([a-zA-Z]+)|\b([A-Z]{2,})\b/g; // Regex pour détecter le ticker
    const tickers = message.match(tickerRegex) ?? [];
    return Array.from(tickers).map(ticker => ticker.replace('$', '').toUpperCase());
}