# DFI earnings automation for DeFiChain

[![npm](https://img.shields.io/npm/v/defichain-compound)](https://www.npmjs.com/package/defichain-compound)
[![GitHub license](https://img.shields.io/github/license/Naereen/StrapDown.js.svg)](https://github.com/DeFiCh/app/blob/main/LICENSE)
<a href="https://www.reddit.com/r/defiblockchain/">
<img alt="Subreddit subscribers" src="https://img.shields.io/reddit/subreddit-subscribers/defiblockchain?style=social">
</a>

## Introduction

`defichain-compound` is a CLI daemon that is running in parallel with `defid` of the [DeFiChain desktop wallet](https://github.com/DeFiCh/app) or [fullnode](https://github.com/DeFiCh/ain). Its purpose is to execute automatic compounding actions based on a configuration file.

## Installation

```
npm -g install defichain-compound
```

## Configuration

The default config file is `~/.defichain-compound`. Using the `--conf` option a different location for the config file can be chosen.

### Compounding Actions

The parameter `TARGET` in the config file defines the compounding action. The following  actions are supported:

| Action | TARGET | Example value for TARGET | Example use case |
|:-|:-|:-|:-|
| Add pool liquidity | Pool pair symbol | `BTC-DFI` | Compounding BTC-DFI pool liquidity mining (currently only DFI pairs are supported) |
| Token swap | Token symbol | `ETH` | DCA into ETH token |
| Wallet transfer | DeFiChain wallet address | `bDEl...wxTgV` | Transfer DFI to [Cake](https://www.cakedefi.com) for staking |

### Example Config File

```
# Connection to defid
RPC_URL=http://user:password@localhost:8554

# Amount of DFI needed before the action is executed 
DFI_COMPOUND_AMOUNT=5

# Wallet address of the desktop client
WALLET_ADDRESS=address

# Target for compounding action (see documentation)
TARGET=wallet address(es) or token symbol(s) or pool pair symbol(s)

# Logfile and pidfile
LOGFILE=/tmp/defichain-compound.log
PIDFILE=/tmp/defichain-compound.pid

# Interval to check if compounding is needed
CHECK_INTERVAL_MINUTES=720
```

### Rotating Actions

`TARGET` can be set to multiple values separated by a single space. The actions are then rotated in order. To keep state across restarts `defichain-compound` will rewrite the config file so that the first listed action in `TARGET` is always the one to execute next.

**Example 1**
```
TARGET=ETH-DFI BTC-DFI DOGE
```
When `DFI_COMPOUND_AMOUNT` is reached for the first time buy into the `ETH-DFI` pool. When again `DFI_COMPOUND_AMOUNT` is reached buy into the `BTC-DFI` pool. When again `DFI_COMPOUND_AMOUNT` is reached buy `DOGE`. Repeat infinitely.

**Example 2**
```
TARGET=BTC-DFI BTC-DFI ETH-DFI
```
Invest into the `BTC-DFI` and `ETH-DFI` pools at a 2:1 ratio.

**Example 3**
```
TARGET=ETH-DFI bDEl...wxTgV
```
Invest half of the earnings into the `ETH-DFI` pool and transfer the other half to `bDEl...wxTgV` for staking.

### Update Config

The daemon updates its config on SIGHUP. Note that LOGFILE and PIDFILE are not updated in this scenario. Example:
```
kill -HUP $(<"/tmp/defichain-compound.pid")
```

### Wallet Passphrase

In order to sign transactions `defichain-compound` needs to know the passphrase of the wallet. The recommended and most secure way is to use the interactive prompt when starting the daemon. 

If fully unattended operation including startup is desired, the passphrase can also be passed via the `DEFICHAIN_WALLET_PASSPHRASE` environment variable. Upon forking its child process into daemon mode `defichain-compound` will then delete the variable from the environment.

## Utility Functions

### Holdings Summary

When started with the `--holdings` option, instead of going into daemon mode an overview of all holdings in the wallet is shown. Optionally a currency symbol can be given as argument to show the values in the respective currency. The default is USD. DFI is also a valid option to get the total equivalent in DFI tokens.

**Example**
```
$ defichain-compound --holdings CHF
╔════════════════════════════════════════════════════════╗
║ Token                     Amount             CHF Value ║
╟────────────────────────────────────────────────────────╢
║ BTC-DFI              14.74536882               3321.08 ║
╟────────────────────────────────────────────────────────╢
║ AAPL-DUSD            43.92371935                897.94 ║
╟────────────────────────────────────────────────────────╢
║ DFI                   4.94089433                  3.31 ║
╟────────────────────────────────────────────────────────╢
║ Total                                          4222.33 ║
╚════════════════════════════════════════════════════════╝
```

NOTE: Because of the current [difficulties with DUSD's peg](https://blog.defichain.com/dex-stabilization-fee/), its value can be determined using various strategies. This calculation is using the ratio of the DUSD-DFI liquidity pool.

## Example Session

Here's an example run with `TARGET=ETH-DFI` for illustration purposes:

```
2022-10-04 09:00:03.652 Balance: 13.41241989 (DFI token: 0.38993539 / UTXO: 13.0224845)
2022-10-04 09:00:03.658 Compound threshold of 5.1 (5 + 0.1) reached
2022-10-04 09:00:03.755 Convert 4.61006461 UTXO to DFI token
2022-10-04 09:00:03.916 Conversion transaction: c7e7...6d26
2022-10-04 09:00:03.916 Waiting for conversion to complete
2022-10-04 09:00:29.500 Conversion completed
2022-10-04 09:00:29.505 Swap 2.5 DFI token to ETH token
2022-10-04 09:00:29.521 Swap transaction: 9a08...2573
2022-10-04 09:00:29.521 Waiting for swap to complete
2022-10-04 09:00:50.743 Received 0.00129444 ETH token
2022-10-04 09:00:50.744 Add pool liquidity 0.00129444 ETH / 2.5 DFI
2022-10-04 09:00:51.649 Add pool liquidity transaction: 04d8...db4a
2022-10-04 09:00:51.649 Waiting for liquidity transaction to complete
2022-10-04 09:02:32.290 Received 0.05677079 ETH-DFI token
```



## Disclaimer

This is not financial advice. Please only run this code if you fully understand what it is doing. This code is provided as-is with no warranty. I take no responsibility for lost funds or any other damage that it might cause. 
