# Frontend — Sepolia console

A single page that reads the deployed contracts and asks MetaMask to sign
transactions. No build step, no bundler, no API key: `ethers` is vendored in
this folder as `ethers.umd.min.js` and loaded as a UMD global.

## Run it

Open `index.html` in a browser. That is enough — `file://` works because there
are no ES modules and no network fetches for local assets.

If you prefer to serve it (closer to how it would be hosted):

```bash
npx --yes serve frontend
# or, with python installed:
python -m http.server 8080 --directory frontend
```

Then connect MetaMask. The page will offer to switch the wallet to Sepolia
(chain id `11155111`) if it is on another network.

## What it shows

| Field | Source |
|---|---|
| MTK balance | `MockToken.balanceOf(you)` |
| Staked | `DeFiStaking.stakers(you).amount` |
| Earned (live) | `DeFiStaking.earned(you)` — recomputed from `block.timestamp` on every read |
| Claimable pending | `DeFiStaking.stakers(you).pendingRewards` — the checkpoint written on your last interaction |
| Pool / rate / paused | `balanceOf(staking)`, `rewardRatePerSecond()`, `paused()` |

The read-only view works before you connect a wallet: it queries a public
Sepolia endpoint (`ethereum-sepolia-rpc.publicnode.com`) so the page is never
empty. Signing always goes through MetaMask; the page never handles a key and
`.env` is not involved.

## Why every write sends an explicit `gasLimit`

This project's Sepolia RPC under-reports `estimateGas` for `withdraw` — it
returned 94,594 and 113,512 for a call that actually consumes 176,873 gas, and
the transactions sent at that limit failed on chain with an empty receipt
(`status 0`, no logs, `gasUsed == gasLimit`). `app.js` therefore sends
`max(estimate × 1.2, floor)` with floors of `approve 80k`, `stake 320k`,
`claimReward 130k`, `withdraw 260k`. Gas on this testnet cost 16 wei, so the
headroom is free. Background and measurements: `../README.md` §5.2.

## Note on semantics

`withdraw()` returns principal only; it does not pay out rewards. The accrued
amount is folded into `pendingRewards` by the `updateReward` modifier and stays
claimable, so a user who withdraws everything can still call `claimReward()`.
The UI surfaces this as two separate fields rather than hiding it.

## Addresses

Hard-coded at the top of `app.js`, matching `../deployments/sepolia.json`:

- MockToken `0x68b78097aa78e0E5f444BbE43E8E904822c0b6d5`
- DeFiStaking `0x988398cF9453F855471f6dAfE706C344741eD2D3`
