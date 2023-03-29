import {JsonRpcClient} from '@defichain/jellyfish-api-jsonrpc';
import {RpcApiError} from '@defichain/jellyfish-api-core';
import {BigNumber} from 'bignumber.js';
import dotenv from 'dotenv';
import {priceOf} from './prices';
import {table} from 'table';
import chalk from 'chalk';
const readlineSync = require('readline-sync');
const child_process = require('child_process');
const fs = require('fs');
const untildify = require('untildify');

let RESERVE = new BigNumber(0.1);
let DEFAULT_CONFIGFILE = '~/.defichain-compound';
let DEFAULT_CHECK_INTERVAL_MINUTES = '720';
let RPC_TIMEOUT = 10 * 60 * 1000;
let TOKEN_LIMIT = 1000;

let walletPassphrase = '';
let daemonInterval: NodeJS.Timer;

function logDate() {
  let tzoffset = new Date().getTimezoneOffset() * 60000;
  let localIsoTime = new Date(Date.now() - tzoffset).toISOString().slice(0, -1);
  return (localIsoTime + ' ').replace('T', ' ');
}

function daemonize() {
  let out = fs.openSync(untildify(process.env.LOGFILE), 'a');
  let err = fs.openSync(untildify(process.env.LOGFILE), 'a');

  let env = process.env;
  env.__daemon = 'true';
  delete env.DEFICHAIN_WALLET_PASSPHRASE;
  let argv = process.argv;
  argv.shift();
  let child = child_process.spawn(process.argv[0], argv, {
    detached: true,
    env: env,
    stdio: ['ignore', out, err, 'ipc'],
  });
  child.send(walletPassphrase);
  child.disconnect();
  child.unref();
  console.log(`Daemon started in background with pid ${child.pid}`);
  fs.writeFileSync(untildify(process.env.PIDFILE), `${child.pid}\n`);
  console.log(`Logfile: ${process.env.LOGFILE}`);
}

function daemonLoop() {
  checkBalances();
  daemonInterval = setInterval(function() {
    checkBalances();
  }, parseInt(process.env.CHECK_INTERVAL_MINUTES ?? DEFAULT_CHECK_INTERVAL_MINUTES) * 60 * 1000);
}

function checkConfig(): boolean {
  let missingParameters = '';

  if (!process.env.RPC_URL) {
    missingParameters += 'RCP_URL\n';
  }
  if (!process.env.DFI_COMPOUND_AMOUNT) {
    missingParameters += 'DFI_COMPOUND_AMOUNT\n';
  }
  if (!process.env.WALLET_ADDRESS) {
    missingParameters += 'WALLET_ADDRESS\n';
  }
  if (!process.env.TARGET) {
    missingParameters += 'TARGET\n';
  }
  if (!process.env.LOGFILE) {
    missingParameters += 'LOGFILE\n';
  }
  if (!process.env.PIDFILE) {
    missingParameters += 'PIDFILE\n';
  }
  if (!process.env.CHECK_INTERVAL_MINUTES) {
    missingParameters += 'CHECK_INTERVAL_MINUTES\n';
  }

  if (missingParameters.length) {
    console.log(`Missing parameters in ${DEFAULT_CONFIGFILE} config file:\n${missingParameters}`);
    return false;
  }

  return true;
}

function promptPassphrase(): string {
  if (process.env.DEFICHAIN_WALLET_PASSPHRASE) {
    return process.env.DEFICHAIN_WALLET_PASSPHRASE;
  } else {
    var passphrase = readlineSync.question('Wallet passphrase: ', {
      hideEchoBack: true,
    });
    return passphrase;
  }
}

async function checkPassphrase(): Promise<boolean> {
  const client = new JsonRpcClient(process.env.RPC_URL!, {timeout: RPC_TIMEOUT});
  const passphrase = promptPassphrase();
  try {
    await client.call('walletpassphrase', [passphrase, 1 * 60], 'bignumber');
    await client.call('walletlock', [], 'bignumber');
  } catch (error) {
    if (error instanceof RpcApiError) {
      console.log(error.payload.message);
    } else {
      console.log(error);
    }
    return false;
  }
  walletPassphrase = passphrase;
  return true;
}

async function provideDusdLiquidityAction(client: JsonRpcClient, dusdTokenBalance: BigNumber, poolPairSymbol: string) {
  const [symbolOfOtherToken] = poolPairSymbol.split('-');
  const amountOfDusdToken = dusdTokenBalance.dividedBy(2);
  const amountOfOtherToken = await swapTokenAction(client, amountOfDusdToken, 'DUSD', symbolOfOtherToken);
  console.log(logDate() + `Add pool liquidity ${amountOfOtherToken} ${symbolOfOtherToken} / ${amountOfDusdToken} DUSD`);
  const txid = await client.poolpair.addPoolLiquidity(
    {
      [process.env.WALLET_ADDRESS!]: [
        `${amountOfOtherToken.toFixed(8)}@${symbolOfOtherToken}`,
        `${amountOfDusdToken.toFixed(8)}@DUSD`,
      ],
    },
    process.env.WALLET_ADDRESS!
  );
  console.log(logDate() + `Add pool liquidity transaction: ${txid}`);

  console.log(logDate() + `Waiting for liquidity transaction to complete`);
  const balances = await client.account.getTokenBalances({limit: 1000}, true, {symbolLookup: true});
  let poolPairBalanceBefore = new BigNumber(0);
  if (balances[poolPairSymbol]) {
    poolPairBalanceBefore = balances[poolPairSymbol];
  }
  let poolPairBalanceAfter = poolPairBalanceBefore;
  while (poolPairBalanceAfter.isEqualTo(poolPairBalanceBefore)) {
    await new Promise(r => setTimeout(r, 5 * 1000));
    const balances = await client.account.getTokenBalances({limit: 1000}, true, {symbolLookup: true});
    if (balances[poolPairSymbol]) {
      poolPairBalanceAfter = balances[poolPairSymbol];
    }
  }
  console.log(logDate() + `Received ${poolPairBalanceAfter.minus(poolPairBalanceBefore)} ${poolPairSymbol} token`);
}

async function provideDfiLiquidityAction(client: JsonRpcClient, dfiTokenBalance: BigNumber, poolPairSymbol: string) {
  if (dfiTokenBalance.isLessThan(new BigNumber(process.env.DFI_COMPOUND_AMOUNT!))) {
    const amountToConvert = new BigNumber(process.env.DFI_COMPOUND_AMOUNT!).minus(dfiTokenBalance);
    await convertUtxoToAccount(client, amountToConvert, new BigNumber(process.env.DFI_COMPOUND_AMOUNT!));
    dfiTokenBalance = await getDfiTokenBalance(client);
  }

  const [symbolOfOtherToken] = poolPairSymbol.split('-');
  const amountOfDfiToken = new BigNumber(process.env.DFI_COMPOUND_AMOUNT!).dividedBy(2);
  const amountOfOtherToken = await swapTokenAction(client, amountOfDfiToken, 'DFI', symbolOfOtherToken);
  console.log(logDate() + `Add pool liquidity ${amountOfOtherToken} ${symbolOfOtherToken} / ${amountOfDfiToken} DFI`);
  const txid = await client.poolpair.addPoolLiquidity(
    {
      [process.env.WALLET_ADDRESS!]: [
        `${amountOfOtherToken.toFixed(8)}@${symbolOfOtherToken}`,
        `${amountOfDfiToken.toFixed(8)}@DFI`,
      ],
    },
    process.env.WALLET_ADDRESS!
  );
  console.log(logDate() + `Add pool liquidity transaction: ${txid}`);

  console.log(logDate() + `Waiting for liquidity transaction to complete`);
  const balances = await client.account.getTokenBalances({limit: 1000}, true, {symbolLookup: true});
  let poolPairBalanceBefore = new BigNumber(0);
  if (balances[poolPairSymbol]) {
    poolPairBalanceBefore = balances[poolPairSymbol];
  }
  let poolPairBalanceAfter = poolPairBalanceBefore;
  while (poolPairBalanceAfter.isEqualTo(poolPairBalanceBefore)) {
    await new Promise(r => setTimeout(r, 5 * 1000));
    const balances = await client.account.getTokenBalances({limit: 1000}, true, {symbolLookup: true});
    if (balances[poolPairSymbol]) {
      poolPairBalanceAfter = balances[poolPairSymbol];
    }
  }
  console.log(logDate() + `Received ${poolPairBalanceAfter.minus(poolPairBalanceBefore)} ${poolPairSymbol} token`);
}

async function convertUtxoToAccount(client: JsonRpcClient, amountToConvert: BigNumber, amountRequired: BigNumber) {
  console.log(logDate() + `Convert ${amountToConvert} UTXO to DFI token`);

  const hash = await client.account.utxosToAccount({
    [process.env.WALLET_ADDRESS!]: `${amountToConvert.toFixed(8)}@DFI`,
  });
  console.log(logDate() + `Conversion transaction: ${hash}`);

  console.log(logDate() + `Waiting for conversion to complete`);
  let dfiTokenBalance;
  do {
    await new Promise(r => setTimeout(r, 5 * 1000));
    dfiTokenBalance = await getDfiTokenBalance(client);
  } while (dfiTokenBalance.isLessThan(amountRequired));
  console.log(logDate() + `Conversion completed`);
}

async function swapTokenAction(
  client: JsonRpcClient,
  fromTokenAmount: BigNumber,
  fromTokenSymbol: string,
  toTokenSymbol: string
): Promise<BigNumber> {
  if (fromTokenSymbol === 'DFI') {
    const dfiTokenBalance = await getDfiTokenBalance(client);
    if (dfiTokenBalance.isLessThan(fromTokenAmount)) {
      const amountToConvert = fromTokenAmount.minus(dfiTokenBalance);
      await convertUtxoToAccount(client, amountToConvert, fromTokenAmount);
    }
  }

  const balances = await client.account.getTokenBalances({limit: TOKEN_LIMIT}, true, {symbolLookup: true});
  let toTokenBalanceBefore = new BigNumber(0);
  if (balances[toTokenSymbol]) {
    toTokenBalanceBefore = balances[toTokenSymbol];
  }

  console.log(logDate() + `Swap ${fromTokenAmount} ${fromTokenSymbol} token to ${toTokenSymbol} token`);
  const txid = await client.poolpair.poolSwap({
    from: process.env.WALLET_ADDRESS!,
    tokenFrom: fromTokenSymbol,
    amountFrom: parseFloat(fromTokenAmount.toFixed(8)),
    to: process.env.WALLET_ADDRESS!,
    tokenTo: toTokenSymbol,
  });
  console.log(logDate() + `Swap transaction: ${txid}`);

  console.log(logDate() + `Waiting for swap to complete`);
  let toTokenBalanceAfter = toTokenBalanceBefore;
  while (toTokenBalanceAfter.isEqualTo(toTokenBalanceBefore)) {
    await new Promise(r => setTimeout(r, 5 * 1000));
    const balances = await client.account.getTokenBalances({limit: TOKEN_LIMIT}, true, {symbolLookup: true});
    if (balances[toTokenSymbol]) {
      toTokenBalanceAfter = balances[toTokenSymbol];
    }
  }
  console.log(logDate() + `Received ${toTokenBalanceAfter.minus(toTokenBalanceBefore)} ${toTokenSymbol} token`);

  return toTokenBalanceAfter.minus(toTokenBalanceBefore);
}

async function transferToWalletAction(client: JsonRpcClient, utxoBalance: BigNumber, walletAddress: string) {
  const amount = new BigNumber(process.env.DFI_COMPOUND_AMOUNT!);

  if (utxoBalance.isLessThan(amount.plus(RESERVE))) {
    const amountToConvert = amount.minus(utxoBalance).plus(RESERVE);
    console.log(logDate() + `Convert ${amountToConvert} DFI token to UTXO`);

    const hash = await client.account.accountToUtxos(process.env.WALLET_ADDRESS!, {
      [process.env.WALLET_ADDRESS!]: `${amountToConvert.toFixed(8)}@DFI`,
    });
    console.log(logDate() + `Convert transaction: ${hash}`);
  }

  console.log(logDate() + `Send ${amount} UTXO to ${walletAddress}`);
  const txid = await client.call('sendtoaddress', [walletAddress, amount.toFixed(8), '', '', false], 'bignumber');
  console.log(logDate() + `Send transaction: ${txid}`);
}

async function getDfiTokenBalance(client: JsonRpcClient): Promise<BigNumber> {
  const tokenBalances = await client.account.getTokenBalances({limit: TOKEN_LIMIT}, true, {symbolLookup: true});
  const dfiTokenBalance = tokenBalances['DFI'];
  return dfiTokenBalance;
}

async function consolidateDfiTokens(client: JsonRpcClient) {
  console.log(logDate() + `Consolidation needed because DFI tokens are spread accross accounts`);

  await client.call('walletpassphrase', [walletPassphrase, 30 * 60], 'bignumber');

  const accounts = await client.account.listAccounts({limit: TOKEN_LIMIT}, false, {
    indexedAmounts: true,
    isMineOnly: true,
  });
  for (const account of accounts) {
    if (account.owner !== process.env.WALLET_ADDRESS! && account.amount['0'] !== undefined) {
      console.log(
        logDate() +
          `Consolidating of ${account.amount['0']} DFI from ${account.owner} to ${process.env.WALLET_ADDRESS!}`
      );
      const txid = await client.account.accountToAccount(account.owner, {
        [process.env.WALLET_ADDRESS!]: `${account.amount['0'].toFixed(8)}@DFI`,
      });
      console.log(logDate() + `Consolidation transaction: ${txid}`);
    }
  }

  await client.call('walletlock', [], 'bignumber');

  console.log(logDate() + `Waiting for consolidation to complete`);
  let dfiTokenBalance, dfiAccountTokenBalance;
  do {
    await new Promise(r => setTimeout(r, 5 * 1000));
    dfiTokenBalance = await getDfiTokenBalance(client);
    const accountTokenBalances = await client.account.getAccount(
      process.env.WALLET_ADDRESS!,
      {},
      {indexedAmounts: true}
    );
    dfiAccountTokenBalance = new BigNumber(accountTokenBalances['0']);
  } while (dfiTokenBalance.isEqualTo(dfiAccountTokenBalance) == false);
  console.log(logDate() + `Consolidation completed`);
}

async function checkBalances() {
  const client = new JsonRpcClient(process.env.RPC_URL!, {timeout: RPC_TIMEOUT});
  const utxoBalance = await client.wallet.getBalance();
  const dfiTokenBalance = await getDfiTokenBalance(client);

  console.log(
    logDate() + `Balance: ${utxoBalance.plus(dfiTokenBalance)} (DFI token: ${dfiTokenBalance} / UTXO: ${utxoBalance})`
  );

  const accountTokenBalances = await client.account.getAccount(process.env.WALLET_ADDRESS!, {}, {indexedAmounts: true});
  const dfiAccountTokenBalance = new BigNumber(accountTokenBalances['0']);
  let hasOtherAccountsToConsolidate = false;
  const accounts = await client.account.listAccounts({limit: TOKEN_LIMIT}, false, {
    indexedAmounts: true,
    isMineOnly: true,
  });
  for (const account of accounts) {
    if (account.owner !== process.env.WALLET_ADDRESS! && account.amount['0'] !== undefined) {
      hasOtherAccountsToConsolidate = true;
    }
  }

  if (hasOtherAccountsToConsolidate && dfiTokenBalance.isEqualTo(dfiAccountTokenBalance) == false) {
    await consolidateDfiTokens(client);
  }

  if (utxoBalance.plus(dfiTokenBalance).isGreaterThan(new BigNumber(process.env.DFI_COMPOUND_AMOUNT!).plus(RESERVE))) {
    console.log(
      logDate() +
        `Compound threshold of ${BigNumber(process.env.DFI_COMPOUND_AMOUNT!).plus(RESERVE)} (${BigNumber(
          process.env.DFI_COMPOUND_AMOUNT!
        )} + ${RESERVE}) reached`
    );

    const poolPairs = await client.poolpair.listPoolPairs({start: 0, including_start: true, limit: TOKEN_LIMIT}, false);
    const supportedDfiPoolPairs = Object.entries(poolPairs)
      .filter(([key, value]) => value.symbol.endsWith('-DFI'))
      .map(pair => pair[1].symbol);
    const supportedDusdPoolPairs = Object.entries(poolPairs)
      .filter(([key, value]) => value.symbol.endsWith('-DUSD'))
      .map(pair => pair[1].symbol);

    await client.call('walletpassphrase', [walletPassphrase, 30 * 60], 'bignumber');

    const targets = process.env.TARGET!.split(/\s(.*)/s);
    if (targets[0].match(/[^ ]{34}/)) {
      await transferToWalletAction(client, utxoBalance, targets[0]);
    } else if (supportedDfiPoolPairs.map(pair => pair.replace('-DFI', '')).includes(targets[0])) {
      await swapTokenAction(client, new BigNumber(process.env.DFI_COMPOUND_AMOUNT!), 'DFI', targets[0]);
    } else if (supportedDusdPoolPairs.map(pair => pair.replace('-DUSD', '')).includes(targets[0])) {
      const amountOfDusdToken = await swapTokenAction(
        client,
        new BigNumber(process.env.DFI_COMPOUND_AMOUNT!),
        'DFI',
        'DUSD'
      );
      await swapTokenAction(client, amountOfDusdToken, 'DUSD', targets[0]);
    } else if (supportedDfiPoolPairs.includes(targets[0])) {
      await provideDfiLiquidityAction(client, dfiTokenBalance, targets[0]);
    } else if (supportedDusdPoolPairs.includes(targets[0])) {
      const amountOfDusdToken = await swapTokenAction(
        client,
        new BigNumber(process.env.DFI_COMPOUND_AMOUNT!),
        'DFI',
        'DUSD'
      );
      await provideDusdLiquidityAction(client, amountOfDusdToken, targets[0]);
    } else {
      console.log(logDate() + `TARGET does not contain a valid value`);
    }

    if (targets.length == 3) {
      try {
        let content = fs.readFileSync(DEFAULT_CONFIGFILE, 'utf8');
        content = content.replace(/^TARGET=.*$/m, `TARGET=${targets[1]} ${targets[0]}`);
        fs.writeFileSync(DEFAULT_CONFIGFILE, content, 'utf8');
        process.env.TARGET = `${targets[1]} ${targets[0]}`;
      } catch (error) {
        console.log(logDate() + `Rewriting of ${DEFAULT_CONFIGFILE} failed: `, error);
      }
    }

    await client.call('walletlock', [], 'bignumber');
  }
}

function rereadConfig() {
  dotenv.config({path: DEFAULT_CONFIGFILE, override: true});
  clearInterval(daemonInterval);
  console.log(logDate() + `Config updated from ${DEFAULT_CONFIGFILE}`);
  daemonLoop();
}

function rightAlign(str: string, totalLength: number): string {
  return ' '.repeat(totalLength - str.length) + str;
}

async function showHoldingsSummary(currency?: string) {
  if (currency == undefined) {
    currency = 'USD';
  } else {
    currency = currency.toUpperCase();
  }

  const client = new JsonRpcClient(process.env.RPC_URL!, {timeout: RPC_TIMEOUT});
  const utxoBalance = await client.wallet.getBalance();
  const tokenBalances = await client.account.getTokenBalances({limit: TOKEN_LIMIT}, true, {symbolLookup: true});

  if (tokenBalances['DFI']) {
    tokenBalances['DFI'] = tokenBalances['DFI'].plus(utxoBalance);
  } else {
    tokenBalances['DFIX'] = utxoBalance;
  }

  let tableConfig = {
    columns: [{width: 10}, {width: 20}, {width: 20}],
    drawVerticalLine: (lineIndex: number, columnCount: number) => {
      return lineIndex === 0 || lineIndex === columnCount;
    },
  };
  let tableContent: [string, string, string][] = [];

  let total = 0;
  for (const item of Object.keys(tokenBalances)) {
    let amount = 0;
    if (item.match(/.*-.*/)) {
      const [tokenA, tokenB] = item.split('-');
      const poolPair = await client.poolpair.getPoolPair(item);
      const amountTokenA = tokenBalances[item]
        .dividedBy(Object.values(poolPair)[0].totalLiquidity)
        .times(Object.values(poolPair)[0].reserveA);
      const amountTokenB = tokenBalances[item]
        .dividedBy(Object.values(poolPair)[0].totalLiquidity)
        .times(Object.values(poolPair)[0].reserveB);
      const priceTokenB = await priceOf(client, tokenB, currency);

      amount = amountTokenB
        .times(priceTokenB)
        .times(new BigNumber(2))
        .toNumber();
    } else {
      const priceToken = await priceOf(client, item, currency);
      amount = tokenBalances[item].times(new BigNumber(priceToken)).toNumber();
    }
    tableContent.push([item, tokenBalances[item].toFixed(8), amount.toFixed(2)]);
    total += amount;
  }

  tableContent.sort((a, b) => b[2].localeCompare(a[2], 'en', {numeric: true}));
  tableContent.unshift(['Token', 'Amount', `${currency} Value`]);
  tableContent.push(['Total', '', total.toFixed(2)]);

  let alignedTableContent = tableContent.map(row => [
    row[0],
    rightAlign(row[1], tableConfig.columns[1].width),
    rightAlign(row[2], tableConfig.columns[2].width),
  ]);
  alignedTableContent[0] = alignedTableContent[0].map(cell => chalk.bold(cell));
  alignedTableContent[alignedTableContent.length - 1] = alignedTableContent[alignedTableContent.length - 1].map(cell =>
    chalk.bold(cell)
  );

  console.log(table(alignedTableContent, tableConfig));
}

export async function daemon(options: any) {
  if (options.conf) {
    DEFAULT_CONFIGFILE = options.conf;
  }
  DEFAULT_CONFIGFILE = untildify(DEFAULT_CONFIGFILE);
  dotenv.config({path: DEFAULT_CONFIGFILE});

  if (options.holdings) {
    if (checkConfig()) {
      await showHoldingsSummary(typeof options.holdings === 'string' ? options.holdings : undefined);
    }
    process.exit(0);
  }

  if (process.env.__daemon) {
    process.on('message', message => {
      walletPassphrase = typeof message === 'string' ? message : '';
      console.log(logDate() + `Daemon started with pid ${process.pid}`);
      process.on('SIGHUP', () => {
        rereadConfig();
      });
      daemonLoop();
    });
    return;
  }

  if (checkConfig() && (await checkPassphrase())) {
    let pid;
    try {
      pid = fs.readFileSync(untildify(process.env.PIDFILE, 'utf8'));
    } catch (error) {}

    let alreadyRunning = false;
    if (pid) {
      try {
        process.kill(pid.trim(), 0);
        alreadyRunning = true;
      } catch (error) {}
    }
    if (!alreadyRunning) {
      daemonize();
    } else {
      console.log(`The daemon is already running with pid ${pid.trim()}`);
    }
  }
}
