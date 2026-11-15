/* DeFiStaking front-end console.
 *
 * No bundler, no build step: ethers is vendored next to this file and loaded
 * as a UMD global. The page only reads the chain and asks MetaMask to sign;
 * it never sees a private key.
 *
 * The addresses below are the ones recorded in deployments/sepolia.json.
 */

const CONFIG = {
  chainId: 11155111,
  chainName: "Sepolia",
  token: "0x68b78097aa78e0E5f444BbE43E8E904822c0b6d5",
  staking: "0x988398cF9453F855471f6dAfE706C344741eD2D3",
  explorer: "https://sepolia.etherscan.io",
};

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function symbol() view returns (string)",
];

const STAKING_ABI = [
  "function totalStaked() view returns (uint256)",
  "function rewardRatePerSecond() view returns (uint256)",
  "function paused() view returns (bool)",
  "function earned(address account) view returns (uint256)",
  "function stakers(address) view returns (uint256 amount, uint256 lastUpdateTime, uint256 pendingRewards)",
  "function stake(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function claimReward()",
];

/* The Sepolia RPC used for this project under-reports estimateGas for
 * `withdraw`. Measured on chain, withdraw consumes ~176,873 gas while the
 * estimate came back at 94,594 / 113,512, so a tx sent at the raw estimate
 * runs out of gas and fails with an empty receipt (status 0, no logs).
 * Sending with a generous explicit limit costs almost nothing here
 * (gasPrice was 16 wei on this testnet) and makes the demo deterministic.
 * See README section 5.2. */
const GAS_FLOOR = {
  approve: 80000n,
  stake: 320000n,
  claimReward: 130000n,
  withdraw: 260000n,
};

const $ = (id) => document.getElementById(id);
const logEl = $("log");
let provider = null;
let signer = null;
let account = null;
let token = null;
let staking = null;

function log(line) {
  const stamp = new Date().toLocaleTimeString();
  logEl.textContent = `[${stamp}] ${line}\n` + logEl.textContent;
}

function fmt(value, digits = 6) {
  const parsed = Number(ethers.formatEther(value));
  if (!Number.isFinite(parsed)) return "—";
  return parsed.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function shorten(addr) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—";
}

function setBadge(text, kind) {
  const badge = $("chain-badge");
  badge.textContent = text;
  badge.className = `badge${kind ? " " + kind : ""}`;
}

/* ---------------------------------------------------------------- read side */

async function refresh() {
  const tokenContract = new ethers.Contract(CONFIG.token, ERC20_ABI, provider);
  const stakingContract = new ethers.Contract(CONFIG.staking, STAKING_ABI, provider);

  const [staked, rate, paused, pool] = await Promise.all([
    stakingContract.totalStaked(),
    stakingContract.rewardRatePerSecond(),
    stakingContract.paused(),
    tokenContract.balanceOf(CONFIG.staking),
  ]);

  $("total-staked").textContent = `${fmt(staked)} MTK`;
  $("rate").textContent = `${rate.toString()} / wei·s`;
  $("pool").textContent = `${fmt(pool)} MTK`;
  $("paused").textContent = paused ? "yes" : "no";

  if (!account) {
    ["wallet", "balance", "staked", "earned", "pending"].forEach((id) => ($(id).textContent = "—"));
    $("addrs").textContent = `MTK ${shorten(CONFIG.token)} · STK ${shorten(CONFIG.staking)}`;
    return;
  }

  const [balance, position, earned] = await Promise.all([
    tokenContract.balanceOf(account),
    stakingContract.stakers(account),
    stakingContract.earned(account),
  ]);

  $("wallet").textContent = shorten(account);
  $("balance").textContent = `${fmt(balance)} MTK`;
  $("staked").textContent = `${fmt(position.amount)} MTK`;
  $("earned").textContent = `${fmt(earned, 9)} MTK`; /* 1e10 wei/s accrues slowly; show more digits */
  $("pending").textContent = `${fmt(position.pendingRewards, 9)} MTK`;
  $("addrs").textContent = `MTK ${shorten(CONFIG.token)} · STK ${shorten(CONFIG.staking)}`;
}

/* ------------------------------------------------------------- wallet setup */

async function connect() {
  if (!window.ethereum) {
    log("No injected wallet found. Install MetaMask and reload.");
    setBadge("no wallet", "bad");
    return;
  }

  provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);

  const network = await provider.getNetwork();
  if (Number(network.chainId) !== CONFIG.chainId) {
    log(`Wallet is on chain ${network.chainId}, switching to ${CONFIG.chainName}…`);
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x" + CONFIG.chainId.toString(16) }],
      });
    } catch (error) {
      setBadge(`wrong network (${network.chainId})`, "bad");
      log("Switch to Sepolia manually in MetaMask, then press Connect again.");
      throw error;
    }
  }

  signer = await provider.getSigner();
  account = await signer.getAddress();
  token = new ethers.Contract(CONFIG.token, ERC20_ABI, signer);
  staking = new ethers.Contract(CONFIG.staking, STAKING_ABI, signer);

  setBadge(`${CONFIG.chainName} · ${shorten(account)}`, "ok");
  log(`Connected ${account}`);
  await refresh();
}

/* --------------------------------------------------------------- write side */

async function send(contract, method, args, label) {
  const fn = contract[method];
  const estimate = await fn.estimateGas(...args);
  const buffered = (estimate * 12n) / 10n;
  const floor = GAS_FLOOR[method] || 0n;
  const gasLimit = buffered > floor ? buffered : floor;

  log(`${label}: estimate ${estimate} → limit ${gasLimit}`);
  const tx = await fn(...args, { gasLimit });
  log(`${label}: ${tx.hash} sent, waiting…`);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`${label} reverted (status ${receipt && receipt.status})`);
  }
  log(`${label}: confirmed in block ${receipt.blockNumber} · ${CONFIG.explorer}/tx/${tx.hash}`);
  return tx;
}

async function readAmount() {
  const raw = $("amount").value.trim();
  if (!raw) throw new Error("Enter an amount first.");
  const amount = ethers.parseEther(raw); /* throws on bad input */
  if (amount <= 0n) throw new Error("Amount must be greater than zero.");
  return amount;
}

function busy(on) {
  ["stake", "claim", "withdraw", "refresh", "connect"].forEach((id) => ($(id).disabled = on));
}

async function guard(fn) {
  if (!signer) {
    log("Connect a wallet first.");
    return;
  }
  busy(true);
  try {
    await fn();
    await refresh();
  } catch (error) {
    /* MetaMask nests the useful line in error.info.error.message */
    const detail =
      (error.info && error.info.error && error.info.error.message) ||
      error.shortMessage ||
      error.message ||
      String(error);
    log(`FAILED: ${detail}`);
  } finally {
    busy(false);
  }
}

function wire() {
  $("connect").onclick = () => guard(connect);

  $("refresh").onclick = () =>
    guard(async () => {
      await refresh();
      log("State re-read from chain.");
    });

  $("stake").onclick = () =>
    guard(async () => {
      const amount = await readAmount();
      const allowance = await token.allowance(account, CONFIG.staking);
      if (allowance < amount) {
        await send(token, "approve", [CONFIG.staking, amount], "approve");
      }
      await send(staking, "stake", [amount], "stake");
    });

  $("claim").onclick = () =>
    guard(async () => {
      await send(staking, "claimReward", [], "claimReward");
    });

  $("withdraw").onclick = () =>
    guard(async () => {
      const position = await staking.stakers(account);
      /* Blank amount means "take everything out", which is what people expect. */
      const amount = $("amount").value.trim() ? await readAmount() : position.amount;
      if (amount === 0n) throw new Error("Nothing staked.");
      await send(staking, "withdraw", [amount], "withdraw");
    });

  if (window.ethereum) {
    window.ethereum.on("accountsChanged", () => window.location.reload());
    window.ethereum.on("chainChanged", () => window.location.reload());
  }
}

/* Read-only view works before connecting, so the page is never empty. */
provider = new ethers.JsonRpcProvider("https://ethereum-sepolia-rpc.publicnode.com");
wire();
refresh()
  .then(() => log("Read-only view ready. Connect a wallet to sign transactions."))
  .catch((error) => log(`Read-only view failed: ${error.message}`));
