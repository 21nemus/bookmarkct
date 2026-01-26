# BookmarkCT Contracts

## Install

```bash
npm install
```

## Compile

```bash
npm run compile
```

## Deploy to BNB Smart Chain Testnet

Set the following environment variables in `contracts/.env`:

```bash
BSC_TESTNET_RPC_URL="https://data-seed-prebsc-1-s1.binance.org:8545"
DEPLOYER_PRIVATE_KEY="your_private_key_without_0x"
```

Deploy:

```bash
npm run deploy:bsc
```

The deploy script prints the contract address.
