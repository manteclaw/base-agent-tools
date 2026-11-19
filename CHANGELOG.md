# Changelog

## 1.0.0 — 2026-11-19

Initial release.

- `base_gas_predict` — Base L2 gas prediction from `eth_feeHistory`
  (current base fee, priority fee, congestion, wait/execute signal,
  confidence, transfer cost estimate).
- `base_mev_scan` — sandwich/frontrunning risk check for a mined
  transaction, plus a sandwich-profitability simulation for a planned
  trade size.
- `base_agent_health` — keyless health check: Base RPC reachability and
  chain id, latest-block freshness, optional wallet ETH balance.
- Bundles the three companion ClawHub skill docs (`gas-price-predictor`,
  `mev-protection-scanner`, `agent-health-monitor`).
- Read-only throughout: public Base RPC only, no keys, no signing, no
  transaction submission.
