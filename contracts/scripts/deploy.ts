import { ethers } from "hardhat";

async function main() {
  const factory = await ethers.getContractFactory("BookmarkCT");
  const contract = await factory.deploy();

  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log(`BookmarkCT deployed to: ${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
