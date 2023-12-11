import axios from 'axios'
import { Data, Service } from './type'

export class CoinGecko implements Service {
    data: Data[] = []
    async start() {
        try {
            this.data = (await axios.get<{coins: Data[]}>("https://api.coingecko.com/api/v3/search")).data.coins
            return true
        } catch(e) {
            console.error("[CoinGecko service] error at start", e)
            return false
        }       
    }
}