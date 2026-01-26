import "dotenv/config";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";

const { BSC_TESTNET_RPC_URL, DEPLOYER_PRIVATE_KEY } = process.env;

const config: HardhatUserConfig = {
  solidity: "0.8.20",
  networks: {
    hardhat: {
      type: "edr-simulated",
    },
    bscTestnet: {
      type: "http",
      url:
        BSC_TESTNET_RPC_URL ||
        "https://data-seed-prebsc-1-s1.binance.org:8545",
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId: 97,
    },
  },
};

export default config;
