# Manteclaw Base Agent Tools

Read-only Base L2 agent tools for OpenClaw, by [@manteclaw](https://clawhub.ai/manteclaw).
The code companion to three ClawHub skills — the same capabilities, as native
agent tools that run inside the gateway instead of Python scripts.

## Install

```bash
openclaw plugins install clawhub:@manteclaw/openclaw-base-agent-tools
```

## Tools

### `base_gas_predict`

Predict optimal gas prices for Base L2 from recent fee history.

- Current base fee, recommended priority fee, total gas price
- Congestion level (`low` / `medium` / `high`) and a wait-vs-execute signal
- Confidence score, average/min/max base fee over the window, block utilization
- Estimated cost of a standard 21,000-gas transfer

Parameters: `blocks` (1–100, default 20), `ethPriceUsd` (default 3000 — your
assumption, not a live quote).

### `base_mev_scan`

Two modes — pass exactly one:

- `txHash`: analyze a **mined** Base transaction for sandwich-attack /
  frontrunning risk. Returns a 0–100 risk score, risk level, indicators, and
  protection recommendations, based on similar transactions in the blocks
  immediately before and after it.
- `tradeSizeEth` (+ optional `slippage`, default 0.5): simulate how
  profitable a sandwich attack would be against a planned trade size.

### `base_agent_health`

Keyless infrastructure status: Base RPC reachability and chain id, latest
block freshness, and an optional wallet's ETH balance against a minimum
(`walletAddress`, `minBalanceEth` default 0.001 ETH).

## What it cannot do (on purpose)

- **No transactions.** Nothing in this plugin submits, signs, or simulates a
  transaction on-chain. Every tool is read-only and advisory.
- **No keys, no secrets.** The only network destination is the configured
  public Base JSON-RPC endpoint (default `https://mainnet.base.org`). There is
  no place to put an API key, and the plugin never asks for one.
- **No API-key tests, no auto-restart, no alerts.** The standalone
  `agent-health-monitor` skill does those; they need secrets and local
  services a published plugin must never hold. This plugin checks the RPC
  and wallet balances only.
- **No ML bot detection.** MEV scoring is heuristic pattern-matching on
  surrounding blocks, not a bot registry or an ML filter.
- **No live ETH price.** USD estimates use the `ethPriceUsd` you pass
  (default 3000) — treat them as rough.
- **Error results are generic by design.** If the RPC request fails, the
  tool returns a fixed message ("Base RPC request failed. Try again
  later.") and the specific upstream error goes to the gateway log only.
  Upstream RPC error text is untrusted — a compromised endpoint could put
  instructions in it — so it is never passed through to the model as tool
  output. (Security fix in 1.0.1 for ClawScan's v1.0.0 finding.)

## Configuration

Optional, under `plugins.entries.manteclaw-base-agent-tools.config`:

| Key | Default | Meaning |
|-----|---------|---------|
| `rpcUrl` | `https://mainnet.base.org` | Public Base JSON-RPC endpoint |
| `minBalanceEth` | `0.001` | Low-gas warning threshold (ETH) |

## Bundled skills

The plugin ships the three companion skill docs under `skills/`:

- [gas-price-predictor](https://clawhub.ai/manteclaw/skills/gas-price-predictor)
- [mev-protection-scanner](https://clawhub.ai/manteclaw/skills/mev-protection-scanner)
- [agent-health-monitor](https://clawhub.ai/manteclaw/skills/agent-health-monitor)

The Python/shell scripts named inside those docs belong to the standalone
skills and are not bundled here — the plugin implements the same
capabilities in TypeScript.

## Links

- Skills: https://clawhub.ai/manteclaw
- Store: https://payhip.com/Manteclaw

## Development

```bash
npm install --no-bin-links   # this VM blocks npm's chown step; --no-bin-links works around it
npm run build                # tsc -> dist/
npm pack --dry-run           # confirm dist/ + openclaw.plugin.json + skills/ are included
```

Requires Node 22.22.3+ / 24 / 25. Built against OpenClaw 2026.11.5
(`pluginApi >=2026.10.4`).
