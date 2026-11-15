# Security Notes

Companion document to `README.md` §7. Evidence for the R4 criterion of the CDS528 rubric.

## How to reproduce

```bash
npm install
npm run compile
npm run scan            # slither .
```

- Analyzer: **Slither 0.11.6** (`pip install slither-analyzer`)
- Scope: `contracts/` plus OpenZeppelin 5.6.1 dependencies (13 contracts, 102 detectors)
- Raw output: [`slither-report.txt`](slither-report.txt)

## Result summary

```
INFO:Slither:. analyzed (13 contracts with 102 detectors), 20 result(s) found
```

| Severity | Count |
|---|---|
| High | 0 |
| Medium | 0 |
| Low | 1 (`timestamp` in `DeFiStaking.withdraw`) |
| Informational | 19 |

No reentrancy, no unchecked external call, no arbitrary-send, no delegatecall, no access-control bypass, no integer overflow (0.8.x checked arithmetic).

### The single Low finding

`timestamp` — `DeFiStaking.withdraw` compares using `block.timestamp`. Reward accrual is *defined* in time units, so a timestamp dependency is the intended mechanism, not a defect. Validator drift (±15 s) changes accrued yield by a negligible fraction and creates no profit opportunity, because there is no randomness, no auction and no price-dependent branch in the contract. The `require(user.amount >= amount)` comparison is on user balance, not on time.

### Informational findings, grouped

| Detector | Applies to | Disposition |
|---|---|---|
| `solc-version`, `pragma` | our pragmas + OZ dependency pragmas | Compiler binary is pinned to 0.8.20 by `hardhat.config.js`; floating pragma accepted for a course project |
| `assembly` | OZ `StorageSlot` | Third-party audited code |
| `shadowing-local` | `MockToken` constructor parameters | Cosmetic; renaming to `_name`/`_symbol` would clear it |
| `too-many-digits` | `1000000 * 10 ** decimals()` | Readability only |
| `unindexed-event-address` | OZ `Pausable.Paused/Unpaused` | Inherited; our own events index the user address |

## Threat model (top 3)

| Threat | Mitigation | Where |
|---|---|---|
| **Reentrancy** — malicious token re-enters `stake`/`withdraw`/`claimReward` | `nonReentrant` on all three; state written before the external call (CEI); OZ `ReentrancyGuard` | `contracts/DeFiStaking.sol` |
| **Access control abuse** — rate/pause griefing | `onlyOwner` on `setRewardRate` / `pause` / `unpause`, all event-logged; `withdraw` intentionally not pausable so users can always exit | same |
| **Accounting integrity / economic drain** — over-withdraw, reward pool over-commitment | strict per-user balance, `require(amount <= staked)`, `pendingRewards` zeroed before transfer | same; residual risk documented in README §8.1 |

Not applicable to this design: oracle manipulation (no price feed), front-running (no auction/swap), flash-loan profit paths (no same-block arbitrage).

## Outstanding recommendations

1. Deploy separate principal (`MTK`) and reward (`RWD`) tokens, or track an explicit `rewardPool` and revert when `claimable > rewardPool`.
2. Replace the per-call division with a global `accRewardPerShare` accumulator so `setRewardRate` cannot retroactively re-price already-elapsed time.
3. Move ownership to a multisig + timelock before any deployment that holds real value.
4. Add an Echidna/Foundry invariant: `sum(stakers.amount) == totalStaked` and `token.balanceOf(staking) >= sum(claimable rewards)`.
