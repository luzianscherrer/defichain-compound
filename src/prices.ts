import { JsonRpcClient } from '@defichain/jellyfish-api-jsonrpc';
import { PoolPairsResult } from '@defichain/jellyfish-api-core/dist/category/poolpair'
const CoinGecko = require('coingecko-api');

const coinGeckoApiClient = new CoinGecko();

let priceCacheDuration = 60*1000;
let priceCache: {[key: string]: number} = {};
let poolPairsCache: PoolPairsResult = {};
let cacheTimestamp = 0;

export async function priceOf(client: JsonRpcClient, token: string, currency: string): Promise<number> 
{
    if(cacheTimestamp < new Date().valueOf()-priceCacheDuration) {
        priceCache = {'DFI': 1};
        poolPairsCache = await client.poolpair.listPoolPairs({start: 0, including_start: true, limit: 1000});
        cacheTimestamp = new Date().valueOf();
    }

    if(priceCache[currency] === undefined) {
        let priceData = await coinGeckoApiClient.simple.price({ ids: ['defichain'], vs_currencies: [currency] });
        priceCache[currency] = parseFloat(priceData.data['defichain'][currency.toLocaleLowerCase()]);
    }

    if(priceCache[token] === undefined) {
        const pair = Object.values(poolPairsCache).find(pair => pair.symbol.startsWith(token));
        const [tokenA, tokenB] = pair!.symbol.split(/-/);
        if(priceCache[tokenB] === undefined) {
            await priceOf(client, tokenB, currency);
        }
        priceCache[token] = Number(pair?.['reserveB/reserveA']);
    }

    return priceCache[token]*priceCache[currency];
}