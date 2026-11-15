require("dotenv").config();
const hre = require("hardhat");

async function main() {
  // 部署前置检查：把“缺私钥”“缺测试币”这类错误直接说清楚，而不是抛晦涩的 ethers 报错
  if (!process.env.PRIVATE_KEY) {
    throw new Error(
      "缺少 PRIVATE_KEY：请在 .env 里填入一个 Sepolia 测试钱包的私钥（64 位十六进制，不带 0x 前缀）"
    );
  }

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH");

  if (balance === 0n) {
    throw new Error(
      `部署账户 ${deployer.address} 的 Sepolia 余额为 0，请先领取测试 ETH：https://cloud.google.com/application/web3/faucet/ethereum/sepolia`
    );
  }

  // 网络自检：确认 RPC 真的是 Sepolia，避免把合约部署到主网花掉真 ETH
  const net = await hre.ethers.provider.getNetwork();
  if (net.chainId !== 11155111n) {
    throw new Error(`当前 RPC 的 chainId 是 ${net.chainId}，不是 Sepolia(11155111)，请检查 SEPOLIA_RPC_URL`);
  }

  // 1. 部署测试代币（同时作为质押币与奖励币）
  const MockToken = await hre.ethers.getContractFactory("MockToken");
  const token = await MockToken.deploy("Mock Token", "MTK");
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("MockToken deployed to:", tokenAddress);

  // 2. 部署质押合约
  const DeFiStaking = await hre.ethers.getContractFactory("DeFiStaking");
  const staking = await DeFiStaking.deploy(tokenAddress, tokenAddress);
  await staking.waitForDeployment();
  const stakingAddress = await staking.getAddress();
  console.log("DeFiStaking deployed to:", stakingAddress);

  // 3. 向质押合约注入奖励资金池（10000 枚）
  const tx = await token.transfer(stakingAddress, hre.ethers.parseEther("10000"));
  await tx.wait();
  console.log("Reward pool funded: 10000 MTK -> ", stakingAddress);

  console.log("\n部署完成，接下来可以执行：");
  console.log(`npx hardhat verify --network sepolia ${tokenAddress} "Mock Token" "MTK"`);
  console.log(
    `npx hardhat verify --network sepolia ${stakingAddress} ${tokenAddress} ${tokenAddress}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
