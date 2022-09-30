import { JsonRpcClient } from '@defichain/jellyfish-api-jsonrpc'
import { RpcApiError } from '@defichain/jellyfish-api-core'
import { BigNumber } from 'bignumber.js'
import dotenv from 'dotenv';
const readlineSync = require('readline-sync');
const child_process = require('child_process');
const fs = require('fs');
const untildify = require('untildify');

let RESERVE = new BigNumber(0.1);
let DEFAULT_CONFIGFILE = '~/.defichain-compound';
let DEFAULT_CHECK_INTERVAL_MINUTES = '720';
let RPC_TIMEOUT = 10*60*1000;
let TOKEN_LIMIT = 1000;

let walletPassphrase = '';
let daemonInterval: NodeJS.Timer;

function logDate() 
{
    let tzoffset = (new Date()).getTimezoneOffset() * 60000;
    let localIsoTime = (new Date(Date.now() - tzoffset)).toISOString().slice(0, -1);
    return (localIsoTime + ' ').replace('T', ' ');
}

function daemonize() 
{
    let out = fs.openSync(untildify(process.env.LOGFILE), 'a');
    let err = fs.openSync(untildify(process.env.LOGFILE), 'a');

    let env = process.env;
    env.__daemon = 'true';
    delete env.DEFICHAIN_WALLET_PASSPHRASE;
    let argv = process.argv;
    argv.shift();
    let child = child_process.spawn(process.argv[0], argv, { detached: true, env: env, stdio: [ 'ignore', out, err, 'ipc' ]  });
    child.send(walletPassphrase);
    child.disconnect();
    child.unref();
    console.log(`Daemon started in background with pid ${child.pid}`);
    fs.writeFileSync(untildify(process.env.PIDFILE), `${child.pid}\n`);
    console.log(`Logfile: ${process.env.LOGFILE}`);
}

function daemonLoop() 
{
    checkBalances();
    daemonInterval = setInterval(function() {
        checkBalances();
    }, parseInt(process.env.CHECK_INTERVAL_MINUTES ?? DEFAULT_CHECK_INTERVAL_MINUTES) * 60*1000);
}

function checkConfig(): boolean 
{
    let missingParameters = '';

    if(!process.env.RPC_URL)                { missingParameters += 'RCP_URL\n'; }
    if(!process.env.DFI_COMPOUND_AMOUNT)    { missingParameters += 'DFI_COMPOUND_AMOUNT\n'; }
    if(!process.env.WALLET_ADDRESS)         { missingParameters += 'WALLET_ADDRESS\n'; }
    if(!process.env.TARGET)                 { missingParameters += 'TARGET\n'; }
    if(!process.env.LOGFILE)                { missingParameters += 'LOGFILE\n'; }
    if(!process.env.PIDFILE)                { missingParameters += 'PIDFILE\n'; }
    if(!process.env.CHECK_INTERVAL_MINUTES) { missingParameters += 'CHECK_INTERVAL_MINUTES\n'; }

    if(missingParameters.length) {
        console.log(`Missing parameters in ${DEFAULT_CONFIGFILE} config file:\n${missingParameters}`);
        return false
    }
    
    return true;
}

function promptPassphrase(): string 
{
    if(process.env.DEFICHAIN_WALLET_PASSPHRASE) {
        return process.env.DEFICHAIN_WALLET_PASSPHRASE;
    } else {
        var passphrase = readlineSync.question('Wallet passphrase: ', {
            hideEchoBack: true
        });        
        return passphrase;
    }
}

async function checkPassphrase(): Promise<boolean> 
{
    const client = new JsonRpcClient(process.env.RPC_URL!, {timeout: RPC_TIMEOUT})
    const passphrase = promptPassphrase();    
    try {
        await client.call('walletpassphrase', [ passphrase, 5*60 ], 'bignumber');
        await client.call('walletlock', [], 'bignumber');
    } catch(error) {
        if(error instanceof RpcApiError) {
            console.log(error.payload.message);
        } else {
            console.log(error);
        }
        return false;
    }
    walletPassphrase = passphrase;
    return true;
}

async function provideLiquidityAction(client: JsonRpcClient, tokenBalance: BigNumber) 
{
    const [symbolOfOtherToken] = process.env.TARGET!.split('-');
    const amountOfDfiToken = new BigNumber(process.env.DFI_COMPOUND_AMOUNT!).dividedBy(2);
    const amountOfOtherToken = await swapTokenAction(client, tokenBalance, amountOfDfiToken, symbolOfOtherToken);
    console.log(logDate() +  `Add pool liquidity ${amountOfOtherToken} ${symbolOfOtherToken} / ${amountOfDfiToken} DFI`);
    const txid = await client.poolpair.addPoolLiquidity(
        { [process.env.WALLET_ADDRESS!]: [ `${amountOfOtherToken.toFixed(8)}@${symbolOfOtherToken}`, `${amountOfDfiToken.toFixed(8)}@DFI` ] },  
        process.env.WALLET_ADDRESS!
    );
    console.log(logDate() +  `Add pool liquidity transaction: ${txid}`);
}

async function swapTokenAction(client: JsonRpcClient, tokenBalance: BigNumber, amount: BigNumber, target: string): Promise<BigNumber> 
{
    if(tokenBalance.isLessThan(amount)) {
        const amountToConvert = amount.minus(tokenBalance);
        console.log(logDate() +  `Convert ${amountToConvert} UTXO to DFI token`);

        const hash = await client.account.utxosToAccount(
            { [process.env.WALLET_ADDRESS!]: `${amountToConvert.toFixed(8)}@DFI` }
        );
        console.log(logDate() + `Conversion transaction: ${hash}`);

        console.log(logDate() + `Waiting for conversion to complete`);
        while(tokenBalance.isLessThan(amount)) {
            await new Promise(r => setTimeout(r, 5*1000));
            tokenBalance = await getDfiTokenBalance(client);
        }
        console.log(logDate() + `Conversion completed`);
    }

    const tokenBalancesBefore = await client.account.getTokenBalances({limit: TOKEN_LIMIT}, true, { symbolLookup: true });
    let tokenBalanceBefore  = new BigNumber(0);
    if(tokenBalancesBefore[target]) {
        tokenBalanceBefore = tokenBalancesBefore[target];
    }

    console.log(logDate() +  `Swap ${amount} DFI token to ${target} token`);
    const txid = await client.poolpair.poolSwap({ 
        from: process.env.WALLET_ADDRESS!, 
        tokenFrom: "DFI",
        amountFrom: amount.toNumber(),
        to: process.env.WALLET_ADDRESS!,
        tokenTo: target
    });
    console.log(logDate() + `Swap transaction: ${txid}`);

    let tokenBalanceAfter = tokenBalanceBefore;
    while(tokenBalanceAfter.isEqualTo(tokenBalanceBefore)) {
        await new Promise(r => setTimeout(r, 5*1000));
        const tokenBalancesAfter = await client.account.getTokenBalances({limit: 1000}, true, { symbolLookup: true });
        if(tokenBalancesAfter[target]) {
            tokenBalanceAfter = tokenBalancesAfter[target];
        }
    }
    console.log(logDate() + `Received ${tokenBalanceAfter.minus(tokenBalanceBefore)} ${target} token`);

    return tokenBalanceAfter.minus(tokenBalanceBefore);
}

async function transferToWalletAction(client: JsonRpcClient, utxoBalance: BigNumber) 
{
    const amount = new BigNumber(process.env.DFI_COMPOUND_AMOUNT!);

    if(utxoBalance.isLessThan(amount.plus(RESERVE))) {
        const amountToConvert = amount.minus(utxoBalance).plus(RESERVE);
        console.log(logDate() +  `Convert ${amountToConvert} DFI token to UTXO`);
    
        const hash = await client.account.accountToUtxos(
             process.env.WALLET_ADDRESS!,
             { [process.env.WALLET_ADDRESS!]: `${amountToConvert.toFixed(8)}@DFI` }
         );
         console.log(logDate() + `Convert transaction: ${hash}`);
    }

    console.log(logDate() +  `Send ${amount} UTXO to ${process.env.TARGET}`);
    const txid = await client.call(
        'sendtoaddress',
        [ process.env.TARGET, amount.toFixed(8), '', '', false ],
        'bignumber'
    );
    console.log(logDate() +  `Send transaction: ${txid}`);
}

async function getDfiTokenBalance(client: JsonRpcClient): Promise<BigNumber> 
{
    const tokenBalances = await client.account.getTokenBalances({limit: TOKEN_LIMIT}, true, { symbolLookup: true });
    const dfiTokenBalance = tokenBalances['DFI'];
    return dfiTokenBalance;
}

async function consolidateDfiTokens(client: JsonRpcClient)
{
    console.log(logDate() + `Consolidation needed because DFI tokens are spread accross accounts`);

    await client.call('walletpassphrase', [ walletPassphrase, 5*60 ], 'bignumber');

    const accounts = await client.account.listAccounts({limit: TOKEN_LIMIT}, false, {indexedAmounts: true, isMineOnly: true});
    for(const account of accounts) {
        if(account.owner !== process.env.WALLET_ADDRESS! && account.amount['0'] !== undefined) {
            console.log(logDate() + `Consolidating of ${account.amount['0']} DFI from ${account.owner} to ${process.env.WALLET_ADDRESS!}`);
            const txid = await client.account.accountToAccount(account.owner, { [process.env.WALLET_ADDRESS!]: `${account.amount['0'].toFixed(8)}@DFI` });
            console.log(logDate() + `Consolidation transaction: ${txid}`);
        }
    }

    await client.call('walletlock', [], 'bignumber');

    console.log(logDate() + `Waiting for consolidation to complete`);
    let dfiTokenBalance, dfiAccountTokenBalance;
    do {
        await new Promise(r => setTimeout(r, 5*1000));
        dfiTokenBalance = await getDfiTokenBalance(client);
        const accountTokenBalances = await client.account.getAccount(process.env.WALLET_ADDRESS!, {}, {indexedAmounts: true});
        dfiAccountTokenBalance = new BigNumber(accountTokenBalances['0']);    
    } while(dfiTokenBalance.isEqualTo(dfiAccountTokenBalance) == false);
    console.log(logDate() + `Consolidation completed`);

}

async function checkBalances() 
{
    const client = new JsonRpcClient(process.env.RPC_URL!, {timeout: RPC_TIMEOUT})
    const utxoBalance = await client.wallet.getBalance();
    const dfiTokenBalance = await getDfiTokenBalance(client);

    console.log(logDate() + `Balance: ${utxoBalance.plus(dfiTokenBalance)} (DFI token: ${dfiTokenBalance} / UTXO: ${utxoBalance})`);

    const accountTokenBalances = await client.account.getAccount(process.env.WALLET_ADDRESS!, {}, {indexedAmounts: true});
    const dfiAccountTokenBalance = new BigNumber(accountTokenBalances['0']);
    if(dfiTokenBalance.isEqualTo(dfiAccountTokenBalance) == false) {
        await consolidateDfiTokens(client);
    }

    if( utxoBalance.plus(dfiTokenBalance).isGreaterThan(new BigNumber(process.env.DFI_COMPOUND_AMOUNT!).plus(RESERVE)) ) {
        console.log(logDate() + `Compound threshold of ${BigNumber(process.env.DFI_COMPOUND_AMOUNT!).plus(RESERVE)} (${BigNumber(process.env.DFI_COMPOUND_AMOUNT!)} + ${RESERVE}) reached`);

        const poolPairs = await client.poolpair.listPoolPairs({start: 0, including_start: true, limit: TOKEN_LIMIT}, false);
        const supportedPoolPairs = Object.entries(poolPairs).filter(([key, value]) => value.symbol.endsWith('-DFI')).map(pair => pair[1].symbol);    

        await client.call('walletpassphrase', [ walletPassphrase, 5*60 ], 'bignumber');

        const targets = process.env.TARGET!.split(/\s(.*)/s);
        if(targets[0].match(/[^ ]{34}/)) {
            await transferToWalletAction(client, utxoBalance);
        } else if(supportedPoolPairs.map(pair => pair.replace('-DFI', '')).includes(targets[0])) {
            await swapTokenAction(client, dfiTokenBalance, new BigNumber(process.env.DFI_COMPOUND_AMOUNT!), process.env.TARGET!);
        } else if(supportedPoolPairs.includes(targets[0])) {
            await provideLiquidityAction(client, dfiTokenBalance);
        } else {
            console.log(logDate() + `TARGET does not contain a valid value`);
        }

        if(targets.length == 3) {
            try {
                let content = fs.readFileSync(DEFAULT_CONFIGFILE, 'utf8');
                content = content.replace(/^TARGET=.*$/m, `TARGET=${targets[1]} ${targets[0]}`);
                fs.writeFileSync(DEFAULT_CONFIGFILE, content, 'utf8');
                process.env.TARGET = `${targets[1]} ${targets[0]}`;
            } catch(error) {
                console.log(logDate() + `Rewriting of ${DEFAULT_CONFIGFILE} failed: `, error);
            }
        }
        
        await client.call('walletlock', [], 'bignumber');
    }

}

function rereadConfig() 
{
    dotenv.config({ path: DEFAULT_CONFIGFILE, override: true });
    clearInterval(daemonInterval);
    console.log(logDate() + `Config updated from ${DEFAULT_CONFIGFILE}`);
    daemonLoop();
}  

export async function daemon(options: any) 
{
    if(options.conf) { DEFAULT_CONFIGFILE = options.conf; }
    DEFAULT_CONFIGFILE = untildify(DEFAULT_CONFIGFILE);
    dotenv.config({ path: DEFAULT_CONFIGFILE });

    if (process.env.__daemon) {
        process.on('message', message => {
            walletPassphrase = ( typeof message === 'string' ? message : '' );
            console.log(logDate() + `Daemon started with pid ${process.pid}`);
            process.on('SIGHUP', () => {
                rereadConfig();
            });
            daemonLoop();
        });            
        return;    
    }

    if(checkConfig() && await checkPassphrase()) {
        let pid;
        try {
            pid = fs.readFileSync(untildify(process.env.PIDFILE, 'utf8'));
        } catch(error) {
        }

        let alreadyRunning = false;
        if(pid) {
            try {
                process.kill(pid.trim(), 0);
                alreadyRunning = true;
            } catch(error) {
            }
        }
        if(!alreadyRunning) {
            daemonize();
        } else {
            console.log(`The daemon is already running with pid ${pid.trim()}`);
        }
    }
}

