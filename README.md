# DFI earnings automation for DeFiChain

[![npm](https://img.shields.io/npm/v/defichain-compound)](https://www.npmjs.com/package/defichain-compound)
[![GitHub license](https://img.shields.io/github/license/Naereen/StrapDown.js.svg)](https://github.com/DeFiCh/app/blob/main/LICENSE)
<a href="https://www.reddit.com/r/defiblockchain/">
<img alt="Subreddit subscribers" src="https://img.shields.io/reddit/subreddit-subscribers/defiblockchain?style=social">
</a>

## Introduction

`defichain-compound` is a CLI daemon that is running in parallel with `defid` of the [DeFiChain desktop wallet](https://github.com/DeFiCh/app) or [fullnode](https://github.com/DeFiCh/ain). Its purpose is to execute automatic compounding tasks based on a configuration file.

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
TARGET=wallet address or token symbol or pool pair symbol

# Logfile and pidfile
LOGFILE=/tmp/defichain-compound.log
PIDFILE=/tmp/defichain-compound.pid

# Interval to check if compounding is needed
CHECK_INTERVAL_MINUTES=720
```

### Update Config

The daemon updates its config on SIGHUP. However LOGFILE and PIDFILE are not updated in this scenario. Example:
```
kill -HUP $(<"/tmp/defichain-compound.pid")
```

### Wallet Passphrase

In order to initiate transfers `defichain-compound` needs to know the passphrase of the wallet. The recommended and most secure way is to use the interactive prompt when starting the daemon.

## Disclaimer

This is not financial advice. Please only run this code if you fully understand what it is doing. This code is provided as-is with no warranty. I take no responsibility for lost funds or any other damage that it might cause. 
