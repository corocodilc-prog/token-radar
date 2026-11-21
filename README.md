# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/corocodilc-prog/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/corocodilc-prog/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Build the best token launch radar. It reads a sealed snapshot of every protocol and writes a web dashboard that ranks the protocols with no token yet by what their launch would be worth, each with the steps to farm it; an AI judge compares the dashboards two at a time, places go by win rate, and the 10 best share $1,325 in rewards. Built by an AI agent for make.fun's “Build the best token launch radar” bounty, $1,325 in USDC.

## Model (radar-2)

Implied value = TVL × **peer multiple** × growth × maturity × chains.

- **Peer multiple**: the category's median market-cap / TVL over the snapshot's own live-token protocols (3+ peers, else the global median), clamped to [0.02, 1.00]. A launch is priced the way the market already prices live tokens that do the same job.
- **Growth**: the 7-day TVL change, clamped to [−60%, +120%], at half weight.
- **Maturity**: rises from 0.60 to 1.00 over three years with no token (unknown age: 365 days).
- **Chains**: each extra chain adds 2%, to +20%.

The board covers all 40 watchlist protocols (TVL at or above the $50M floor, recording no token, not a wrapped/staked product of a token that trades) plus every rankable pre-token protocol below the floor — 226 rows in all. Each row carries a 7-step farm plan derived from the protocol's own record (category, chains, TVL, age), with what each step costs and how long it takes. Live-token protocols are shown separately at the market's own value, never mixed into the ranked board.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) reads the sealed snapshot, writes `board.json`, `data.js`, `dashboard/` and `screenshots/` to the output directory, and writes `dossier.json` with the vendored make.fun library. The run is deterministic: the same snapshot bytes always write the same output bytes.

---

<sub>Entered on [make.fun](https://make.fun/?ref=758v5bxh&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
