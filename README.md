# DFI earnings automation for DeFiChain

## Introduction

`defichain-compound` is a CLI daemon that is running in tandem and communicating with defid of the [DeFiChain desktop wallet](https://github.com/DeFiCh/app). Its purpose is to execute automatic compounding tasks based on a configuration file.

## Installation

```
npm -g install defichain-compound
```

## Configuration

The default config file is `~/.defichain-compound`. Using the `--conf` option a different location for the config file can be chosen.

### Example Config File

```
# Connection to defid
RPC_URL=http://user:password@localhost:8554

# Amount of DFI needed before the action is executed 
# Always keeping additional UTXO_BUFFER available for transaction fees
DFI_COMPOUND_AMOUNT=5
UTXO_BUFFER=0.5

# Wallet address of the desktop client (sender) and the 
# compounding recipient (DeFiChain native addresses only)
WALLET_ADDRESS=address
RECIPIENT_ADDRESS=address

# Logfile and pidfile
LOGFILE=/tmp/defichain-compound.log
PIDFILE=/tmp/defichain-compound.pid

# Check if compounding is needed in this interval
CHECK_INTERVAL_MINUTES=720

```

### Wallet Passphrase

In order to initiate transfers `defichain-compound` needs to know the passphrase of the desktop wallet. The recommended and most secure way is to use the interactive prompt when starting the daemon.

## Disclaimer

This is not financial advice. Please only run this code if you fully understand what it is doing. This code is provided as-is with no warranty. I take no responsibility for lost funds while using it. 
