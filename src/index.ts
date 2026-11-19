/**
 * mantecclaw-base-agent-tools — read-only Base L2 agent tools.
 *
 * Three tools, one per ClawHub skill by @manteclaw:
 * - base_gas_predict: optimal gas prices + wait/execute signal (gas-price-predictor)
 * - base_mev_scan: sandwich/frontrunning risk for a tx, or a sandwich simulation (mev-protection-scanner)
 * - base_agent_health: Base RPC + optional wallet balance status (agent-health-monitor)
 *
 * Read-only and advisory only: no transaction execution, no signing, no
 * private keys, no wallet operations, no fund movement. The only network
 * destination is the configured public Base JSON-RPC endpoint
 * (default https://mainnet.base.org). No API keys are needed or used.
 */
import { Type } from "typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { jsonResult } from "openclaw/plugin-sdk/tool-results";
import { DEFAULT_RPC_URL } from "./rpc.js";
import { predictGas } from "./tools/gas.js";
import { checkTransaction, simulateSandwich } from "./tools/mev.js";
import { checkHealth } from "./tools/health.js";

type UnknownRecord = Record<string, unknown>;

function asRecord(params: unknown): UnknownRecord {
  return (params ?? {}) as UnknownRecord;
}

function readOptionalNumber(
  params: UnknownRecord,
  key: string,
  fallback: number,
): number {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readOptionalString(
  params: UnknownRecord,
  key: string,
): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function errorResult(message: string) {
  return jsonResult({ error: message });
}

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export default definePluginEntry({
  id: "manteclaw-base-agent-tools",
  name: "Manteclaw Base Agent Tools",
  description:
    "Read-only Base L2 agent tools: gas prediction, MEV risk scans, and agent health checks. No keys, no signing, no transactions.",
  register(api) {
    const cfg = (api.pluginConfig ?? {}) as UnknownRecord;
    const rpcUrl =
      typeof cfg.rpcUrl === "string" && cfg.rpcUrl.startsWith("http")
        ? cfg.rpcUrl
        : DEFAULT_RPC_URL;
    const minBalanceEth =
      typeof cfg.minBalanceEth === "number" &&
      Number.isFinite(cfg.minBalanceEth) &&
      cfg.minBalanceEth > 0
        ? cfg.minBalanceEth
        : 0.001;

    api.registerTool({
      name: "base_gas_predict",
      label: "Base gas prediction",
      description:
        "Predict optimal gas prices for Base L2 from the last N blocks of fee history: current base fee, recommended priority fee, congestion level, wait-vs-execute signal, confidence, and estimated cost of a standard transfer. Read-only; returns advice only, never submits a transaction.",
      parameters: Type.Object({
        blocks: Type.Optional(
          Type.Integer({ minimum: 1, maximum: 100, default: 20 }),
        ),
        ethPriceUsd: Type.Optional(
          Type.Number({ minimum: 0, default: 3000 }),
        ),
      }),
      async execute(_id, params) {
        const p = asRecord(params);
        const blocks = Math.min(
          100,
          Math.max(1, Math.floor(readOptionalNumber(p, "blocks", 20))),
        );
        const ethPriceUsd = readOptionalNumber(p, "ethPriceUsd", 3000);
        try {
          return jsonResult(await predictGas(rpcUrl, blocks, ethPriceUsd));
        } catch (err) {
          return errorResult((err as Error).message);
        }
      },
    });

    api.registerTool({
      name: "base_mev_scan",
      label: "Base MEV risk scan",
      description:
        "Scan a mined Base transaction for sandwich-attack / frontrunning risk (0-100 score with indicators and protection recommendations), or simulate how profitable a sandwich attack would be against a planned trade size. Read-only analysis only; never submits or simulates a transaction on-chain.",
      parameters: Type.Object({
        txHash: Type.Optional(Type.String()),
        tradeSizeEth: Type.Optional(Type.Number({ minimum: 0 })),
        slippage: Type.Optional(
          Type.Number({ minimum: 0, maximum: 100, default: 0.5 }),
        ),
      }),
      async execute(_id, params) {
        const p = asRecord(params);
        const txHash = readOptionalString(p, "txHash");
        const tradeSizeEth =
          typeof p.tradeSizeEth === "number" ? p.tradeSizeEth : undefined;
        const slippage = readOptionalNumber(p, "slippage", 0.5);

        if (txHash !== undefined && tradeSizeEth !== undefined) {
          return errorResult(
            "Pass exactly one of txHash (check a mined transaction) or tradeSizeEth (simulate a planned trade).",
          );
        }
        if (txHash !== undefined) {
          if (!TX_HASH_RE.test(txHash)) {
            return errorResult(
              `"${txHash}" is not a valid transaction hash (expected 0x + 64 hex chars).`,
            );
          }
          try {
            return jsonResult(await checkTransaction(rpcUrl, txHash));
          } catch (err) {
            return errorResult((err as Error).message);
          }
        }
        if (tradeSizeEth !== undefined) {
          return jsonResult(simulateSandwich(tradeSizeEth, slippage));
        }
        return errorResult(
          "Pass txHash to check a mined transaction, or tradeSizeEth (with optional slippage) to simulate a planned trade.",
        );
      },
    });

    api.registerTool({
      name: "base_agent_health",
      label: "Base agent health check",
      description:
        "Check agent infrastructure health the keyless way: Base RPC reachability and chain id, latest-block freshness, and an optional wallet's ETH balance against a minimum. Read-only. Does not test API keys, restart processes, or send alerts — those need secrets this plugin never holds.",
      parameters: Type.Object({
        walletAddress: Type.Optional(Type.String()),
        minBalanceEth: Type.Optional(Type.Number({ minimum: 0 })),
      }),
      async execute(_id, params) {
        const p = asRecord(params);
        const walletAddress = readOptionalString(p, "walletAddress");
        const minBalance =
          typeof p.minBalanceEth === "number" &&
          Number.isFinite(p.minBalanceEth) &&
          p.minBalanceEth >= 0
            ? p.minBalanceEth
            : minBalanceEth;
        try {
          return jsonResult(await checkHealth(rpcUrl, walletAddress, minBalance));
        } catch (err) {
          return errorResult((err as Error).message);
        }
      },
    });
  },
});
