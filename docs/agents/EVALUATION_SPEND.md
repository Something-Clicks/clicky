# Model evaluation spending ledger

Owner-approved cap: **$500 total** for the whole capped model evaluation (a limit, not a target). Planning ceiling $250. **Stop and ask at $450.** No always-on server. No spending beyond the cap is requested or assumed. Milestone 1 authorizes **no** purchase.

| Running total | Cap | Remaining |
|---|---|---|
| **$0.00** | $500.00 | $500.00 |

## Rules
- Every rental or paid action gets a row below *before* the next one starts: date, provider, GPU, start/stop (UTC), billed hours, rate, cost, running total, shut-down confirmed (yes/no), storage deleted (yes/no).
- A provider account used for this must hold no more prepaid credit than the remaining cap, so the provider itself enforces the limit.
- Storage and idle time count. Volumes and instances are deleted when a session ends or pauses.
- Free credit used is logged too, at the equivalent paid price, so cost per business stays comparable.

## Sessions
| # | Date | Provider | GPU | Start–stop (UTC) | Hours | Rate | Cost | Running total | Shut down | Storage deleted |
|---|---|---|---|---|---|---|---|---|---|---|
| – | – | – | – | – | – | – | – | $0.00 | – | – |

## Milestones
| Event | Commit | Date |
|---|---|---|
| Plan and criteria written (Milestone 1) | see `git log` for `MODEL_EVALUATION_PLAN.md` | Nov 26 2026 |
| Evaluation set frozen (dataset hash `c0b4dd98…`, see `EVALUATION_FREEZE.md`) | the commit containing `evals/model/dataset/FREEZE.json` | Nov 26 2026 |
| First model run | not yet | – |
