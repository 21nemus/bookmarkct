import "dotenv/config";
import { ethers } from "ethers";
import fs from "fs";
import path from "path";

async function main() {
  const rpcUrl = process.env.BSC_TESTNET_RPC_URL;
  if (!rpcUrl) {
    throw new Error("BSC_TESTNET_RPC_URL missing in contracts/.env");
  }

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY missing in contracts/.env");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  const artifactPath = path.join(
    process.cwd(),
    "artifacts",
    "contracts",
    "BookmarkCT.sol",
    "BookmarkCT.json"
  );

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    wallet
  );

  const contract = await factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("BookmarkCT deployed to:", address);

  const outputPath = path.join(
    process.cwd(),
    "..",
    "lib",
    "onchain",
    "bookmarkct.testnet.json"
  );

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        chainId: 97,
        address,
        abi: artifact.abi
      },
      null,
      2
    )
  );

  console.log("On-chain config written to:", outputPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
