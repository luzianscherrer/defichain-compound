import { WhaleApiClient } from '@defichain/whale-api-client';
const CoinGecko = require('coingecko-api');

const whaleApiClient = new WhaleApiClient({
    url: 'https://ocean.defichain.com',
    timeout: 60000,
    version: 'v0',
    network: 'mainnet'
});

const coinGeckoApiClient = new CoinGecko();

let fiatPriceCacheDuration = 60*1000;
let fiatPriceCache: {[key: string]: number} = {};
let fiatPriceCacheTimestamp = 0;

export async function fiatPriceOf(token: string): Promise<number> 
{
    if(fiatPriceCacheTimestamp < new Date().valueOf()-fiatPriceCacheDuration) {
        fiatPriceCache = {};
        fiatPriceCacheTimestamp = new Date().valueOf();
    }
    
    if(fiatPriceCache[token] === undefined) {
        if(token === 'DUSD') {
            let priceData = await coinGeckoApiClient.simple.price({ ids: ['decentralized-usd'], vs_currencies: ['usd'] });
            fiatPriceCache[token] = parseFloat(priceData.data['decentralized-usd'].usd);
        } else {
            const ret = await whaleApiClient.prices.get(token, 'USD');
            fiatPriceCache[token] = Number(ret.price.aggregated.amount);    
        }
    }
    return fiatPriceCache[token];
}