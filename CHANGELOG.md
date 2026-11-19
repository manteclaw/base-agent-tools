# Changelog

## 1.0.3 — 2026-11-19

Re-bundled skill docs updated to the patched v1.0.3 versions (independent
pre-publish vetting follow-ups):

- `gas-price-predictor`: RPC failures now print a fixed message only —
  the raw `requests` exception could leak a keyed provider URL.
- `agent-health-monitor`: unconfigured wallets are skipped instead of
  reporting phantom LOW gas; a crashed balance check is reported as a
  failure, never a pass; `requirements.txt` + install step documented.

No plugin code changes in 1.0.3 — the TypeScript tools are identical to
1.0.1.

## 1.0.2 — 2026-11-19

Re-bundled skill docs updated to the patched v1.0.2 versions:

- `mev-protection-scanner`: the `ALCHEMY_API_KEY` / `--alchemy-key` path
  is gone (v1.0.1 rescan: CRITICAL TT3 + SDI-4); endpoint is a whole URL
  only, never printed.
- `gas-price-predictor`, `agent-health-monitor`: declared tool scope in
  the frontmatter (`permissions`), clearing the LP3 / LP1 findings.

No plugin code changes in 1.0.2 — the TypeScript tools are identical to
1.0.1.

## 1.0.1 — 2026-11-19

Security fix for ClawScan's v1.0.0 finding (verdict: suspicious):
upstream RPC error text could reach the model as tool output, a
prompt-injection channel.

- `src/rpc.ts`: RPC failures now raise fixed messages only. A JSON-RPC
  error response surfaces at most its numeric error code; fetch/timeout/
  parse failures surface a fixed message. Upstream error text is never
  attached to a thrown error.
- `src/index.ts`: tool catch blocks return a fixed "Base RPC request
  failed. Try again later." and log the real error server-side
  (`console.error`, gateway log only). Validation errors no longer echo
  the supplied `txHash` back. `tradeSizeEth`, `slippage`, and
  `ethPriceUsd` are now validated at runtime (non-negative, finite,
  slippage 0–100), matching their declared schemas.
- `src/tools/health.ts`: RPC/balance failure details are fixed strings;
  an invalid wallet address is no longer echoed back.
- `src/tools/mev.ts`: `to_address` is only passed through when it is
  address-shaped; anything else from the RPC response becomes `""`.

Behaviour change: error results are now generic by design — the specific
upstream error is in the gateway log, not in the tool result. Valid
inputs produce identical results to 1.0.0.

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
