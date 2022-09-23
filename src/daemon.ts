import { JsonRpcClient } from '@defichain/jellyfish-api-jsonrpc'
import { RpcApiError } from '@defichain/jellyfish-api-core'
import { BigNumber } from 'bignumber.js'
var readlineSync = require('readline-sync');
import dotenv from 'dotenv';
let child_process = require('child_process');
let fs = require('fs');

let RESERVE = new BigNumber(0.1);

let walletPassphrase = '';

function logDate() {
    let tzoffset = (new Date()).getTimezoneOffset() * 60000;
    let localIsoTime = (new Date(Date.now() - tzoffset)).toISOString().slice(0, -1);
    return (localIsoTime + ' ').replace('T', ' ');
}

function daemonize() {
    let out = fs.openSync(process.env.LOGFILE, 'a');
    let err = fs.openSync(process.env.LOGFILE, 'a');

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
    fs.writeFileSync(process.env.PIDFILE, `${child.pid}\n`);
    console.log(`Logfile: ${process.env.LOGFILE}`);
}

function daemonLoop() {
    checkBalances();
    setInterval(function() {
        checkBalances();
    }, parseInt(process.env.CHECK_INTERVAL_MINUTES ?? '720') * 60*1000);
}

function checkConfig(configFile: string): boolean {
    let missingParameters = '';

    if(!process.env.RPC_URL)                { missingParameters += 'RCP_URL\n'; }
    if(!process.env.DFI_COMPOUND_AMOUNT)    { missingParameters += 'DFI_COMPOUND_AMOUNT\n'; }
    if(!process.env.WALLET_ADDRESS)         { missingParameters += 'WALLET_ADDRESS\n'; }
    if(!process.env.TARGET)                 { missingParameters += 'TARGET\n'; }
    if(!process.env.LOGFILE)                { missingParameters += 'LOGFILE\n'; }
    if(!process.env.PIDFILE)                { missingParameters += 'PIDFILE\n'; }
    if(!process.env.CHECK_INTERVAL_MINUTES) { missingParameters += 'CHECK_INTERVAL_MINUTES\n'; }

    if(missingParameters.length) {
        console.log(`Missing parameters in ${configFile} config file:\n${missingParameters}`);
        return false
    }
    
    return true;
}

function promptPassphrase(): string {
    if(process.env.DEFICHAIN_WALLET_PASSPHRASE) {
        return process.env.DEFICHAIN_WALLET_PASSPHRASE;
    } else {
        var passphrase = readlineSync.question('Wallet passphrase: ', {
            hideEchoBack: true
        });        
        return passphrase;
    }
}

async function checkPassphrase(): Promise<boolean> {
    const client = new JsonRpcClient(process.env.RPC_URL!)
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

async function swapTokenAction(client: JsonRpcClient, tokenBalance: BigNumber): Promise<BigNumber> {
    const amount = new BigNumber(process.env.DFI_COMPOUND_AMOUNT!);

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
            const tokenBalances = await client.account.getTokenBalances({limit: 100}, true, { symbolLookup: true });
            tokenBalance = tokenBalances['DFI'];
        }
        console.log(logDate() + `Conversion completed`);
    }

    const tokenBalancesBefore = await client.account.getTokenBalances({limit: 100}, true, { symbolLookup: true });
    let tokenBalanceBefore  = new BigNumber(0);
    if(tokenBalancesBefore[process.env.TARGET!]) {
        tokenBalanceBefore = tokenBalancesBefore[process.env.TARGET!];
    }

    console.log(logDate() +  `Swap ${amount} DFI token to ${process.env.TARGET} token`);
    const txid = await client.poolpair.poolSwap({ 
        from: process.env.WALLET_ADDRESS!, 
        tokenFrom: "DFI",
        amountFrom: amount.toNumber(),
        to: process.env.WALLET_ADDRESS!,
        tokenTo: process.env.TARGET!
    });
    console.log(logDate() + `Swap transaction: ${txid}`);

    let tokenBalanceAfter = tokenBalanceBefore;
    while(tokenBalanceAfter.isEqualTo(tokenBalanceBefore)) {
        await new Promise(r => setTimeout(r, 5*1000));
        const tokenBalancesAfter = await client.account.getTokenBalances({limit: 100}, true, { symbolLookup: true });
        if(tokenBalancesAfter[process.env.TARGET!]) {
            tokenBalanceAfter = tokenBalancesAfter[process.env.TARGET!];
        }
    }
    console.log(logDate() + `Received ${tokenBalanceAfter.minus(tokenBalanceBefore)} ${process.env.TARGET!} token`);

    return tokenBalanceAfter.minus(tokenBalanceBefore);
}

async function transferToWalletAction(client: JsonRpcClient, utxoBalance: BigNumber) {
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

async function checkBalances() {
    const client = new JsonRpcClient(process.env.RPC_URL!)
    const utxoBalance = await client.wallet.getBalance();
    const tokenBalances = await client.account.getTokenBalances({limit: 100}, true, { symbolLookup: true });

    console.log(logDate() + `Balance: ${utxoBalance.plus(tokenBalances['DFI'])} (DFI token: ${tokenBalances['DFI']} / UTXO: ${utxoBalance})`);

    if( utxoBalance.plus(tokenBalances['DFI']).isGreaterThan(new BigNumber(process.env.DFI_COMPOUND_AMOUNT!).plus(RESERVE)) ) {
        console.log(logDate() + `Compound threshold of ${BigNumber(process.env.DFI_COMPOUND_AMOUNT!).plus(RESERVE)} (${BigNumber(process.env.DFI_COMPOUND_AMOUNT!)} + ${RESERVE}) reached`);

        await client.call('walletpassphrase', [ walletPassphrase, 5*60 ], 'bignumber');

        if(process.env.TARGET!.length === 34) {
            await transferToWalletAction(client, utxoBalance);
        } else if(process.env.TARGET!.length === 3 || process.env.TARGET!.length === 4) {
            await swapTokenAction(client, tokenBalances['DFI']);
        } else {
            console.log(logDate() + `TARGET does not contain a valid value`);
        }

        await client.call('walletlock', [], 'bignumber');
    }

}

export async function daemon(options: any) {
    let configFile = options.conf ?? '~/.defichain-compound';
    dotenv.config({ path: configFile });

    if (process.env.__daemon) {
        process.on('message', message => {
            walletPassphrase = ( typeof message === 'string' ? message : '' );
            console.log(logDate() + `Daemon started with pid ${process.pid}`);
            daemonLoop();
        });            
        return;    
    }

    if(checkConfig(configFile) && await checkPassphrase()) {
        let pid;
        try {
            pid = fs.readFileSync(process.env.PIDFILE, 'utf8');
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

