/**
 * End-to-end demo on Sepolia: approve -> stake -> wait -> claim -> withdraw.
 * Addresses are read from deployments/sepolia.json so the script never drifts
 * from the recorded deployment.
 *
 * Usage: npm run demo
 * Costs a few hundredths of a testnet ETH in gas. Prints every tx hash.
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
require("dotenv").config();

const ERC20_ABI = [
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
];
const STAKING_ABI = [
  "function stake(uint256)",
  "function withdraw(uint256)",
  "function claimReward()",
  "function earned(address) view returns (uint256)",
  "function totalStaked() view returns (uint256)",
];

const AMOUNT = ethers.parseEther("100"); // 100 MTK
const WAIT_SECONDS = 90; // long enough for a visible accrual, short enough for a demo

/**
 * Gas limits are the floor of "estimate + 20%" and a per-function minimum.
 *
 * Why the floor is needed: this project's Sepolia RPC under-reports
 * estimateGas for `withdraw`. Measured on-chain, withdraw consumes ~176,873
 * gas, while eth_estimateGas returned 94,594 and 113,512 for the same call —
 * the tx then ran out of gas and failed with an empty receipt (status 0,
 * no logs, no revert data). `stake` (~286,373) and `claimReward` (~71,516)
 * were estimated correctly, so this is an RPC-side underestimate, not a
 * contract bug: a static call on the identical state succeeds.
 */
const GAS_FLOOR = {
  approve: 80000n,
  stake: 320000n,
  claimReward: 130000n,
  withdraw: 260000n,
};

async function send(contract, method, args, label) {
  const fn = contract[method];
  const estimate = await fn.estimateGas(...args);
  const buffered = (estimate * 12n) / 10n; // +20%
  const floor = GAS_FLOOR[method] || 0n;
  const gasLimit = buffered > floor ? buffered : floor;
  const tx = await fn(...args, { gasLimit });
  await tx.wait();
  console.log(`${label.padEnd(16)} ${tx.hash}  (estimate ${estimate}, limit ${gasLimit})`);
  return tx;
}

async function main() {
  const record = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployments", "sepolia.json"), "utf8")
  );
  const tokenAddr = record.contracts.MockToken.address;
  const stakingAddr = record.contracts.DeFiStaking.address;

  if (!process.env.PRIVATE_KEY || !process.env.SEPOLIA_RPC_URL) {
    throw new Error("SEPOLIA_RPC_URL and PRIVATE_KEY must be set in .env");
  }

  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY.trim().replace(/^0x/, ""), provider);
  const token = new ethers.Contract(tokenAddr, ERC20_ABI, signer);
  const staking = new ethers.Contract(stakingAddr, STAKING_ABI, signer);

  const net = await provider.getNetwork();
  if (net.chainId !== 11155111n) {
    throw new Error(`refusing to run on chainId ${net.chainId}; expected 11155111`);
  }

  const me = await signer.getAddress();
  const balBefore = await token.balanceOf(me);
  console.log(`account          ${me}`);
  console.log(`MTK before       ${ethers.formatEther(balBefore)}`);

  await send(token, "approve", [stakingAddr, AMOUNT], "approve");
  await send(staking, "stake", [AMOUNT], "stake");
  console.log(`totalStaked      ${ethers.formatEther(await staking.totalStaked())} MTK`);

  console.log(`\nwaiting ${WAIT_SECONDS}s of chain time for the reward to accrue...`);
  for (let i = 0; i < WAIT_SECONDS; i += 10) {
    await new Promise((r) => setTimeout(r, 10000));
    console.log(`  earned()       ${ethers.formatEther(await staking.earned(me))} MTK`);
  }

  const earnedBefore = await staking.earned(me);
  await send(staking, "claimReward", [], "claimReward");
  console.log(`reward claimed   ${ethers.formatEther(earnedBefore)} MTK`);

  await send(staking, "withdraw", [AMOUNT], "withdraw");

  const balAfter = await token.balanceOf(me);
  console.log(`\nMTK after        ${ethers.formatEther(balAfter)}`);
  console.log(`net gain         ${ethers.formatEther(balAfter - balBefore)} MTK (gas paid in ETH)`);
  console.log(`totalStaked      ${ethers.formatEther(await staking.totalStaked())} MTK`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
