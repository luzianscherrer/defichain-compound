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

In order to initiate transfers `defichain-compound` needs to know the passphrase of the wallet. The recommended and most secure way is to use the interactive prompt when starting the daemon.

## Disclaimer

This is not financial advice. Please only run this code if you fully understand what it is doing. This code is provided as-is with no warranty. I take no responsibility for lost funds or any other damage that it might cause. 
