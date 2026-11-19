/**
 * Agent health check — keyless subset of the agent-health-monitor skill
 * (scripts/healthcheck.py + master_monitor.py), adapted for a published
 * plugin.
 *
 * What it checks (read-only, public Base RPC only):
 * - the configured RPC answers and reports chain 8453 (Base);
 * - the latest block is fresh (Base produces a block every ~2s; older
 *   than 120s counts as stale);
 * - an optional wallet address holds at least the configured minimum
 *   balance (default 0.001 ETH);
 * - the local runtime (Node version, process uptime).
 *
 * What it deliberately does NOT do, and why: the original skill tests
 * API keys (Alchemy, Groq, Mistral, OpenRouter, Dune, GitHub, Bankr),
 * auto-restarts daemons via a supervisor, and sends Telegram/Discord
 * alerts. All of those need secrets or local services a published
 * plugin must never hold or touch. If you need API-key checks, run the
 * standalone agent-health-monitor skill from ClawHub instead.
 */
import { BASE_CHAIN_ID, hexToNumber, rpcCall, weiHexToEth } from "../rpc.js";

export interface HealthCheckItem {
  name: string;
  ok: boolean;
  detail: string;
}

export interface HealthResult {
  overall: "healthy" | "degraded" | "unhealthy";
  checks: HealthCheckItem[];
  rpc_url: string;
  timestamp: string;
  note: string;
}

const NOTE =
  "Keyless subset of the agent-health-monitor skill: checks the Base RPC and an optional wallet balance only. " +
  "It does not test API keys, restart daemons, or send alerts — those need secrets this plugin never holds.";

function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export async function checkHealth(
  rpcUrl: string,
  walletAddress: string | undefined,
  minBalanceEth: number,
): Promise<HealthResult> {
  const checks: HealthCheckItem[] = [];
  let rpcOk = true;

  // 1. Chain id must be Base (8453).
  try {
    const chainId = await rpcCall<string>(rpcUrl, "eth_chainId", []);
    const ok = hexToNumber(chainId) === BASE_CHAIN_ID;
    if (!ok) rpcOk = false;
    checks.push({
      name: "Base RPC",
      ok,
      detail: ok
        ? "reachable, chain 8453 (Base)"
        : `reachable but wrong chain: ${hexToNumber(chainId)} (expected 8453)`,
    });
  } catch (err) {
    rpcOk = false;
    checks.push({
      name: "Base RPC",
      ok: false,
      detail: `unreachable: ${(err as Error).message}`,
    });
  }

  // 2. Latest block freshness.
  if (rpcOk) {
    try {
      const latest = await rpcCall<{ number: string; timestamp: string }>(
        rpcUrl,
        "eth_getBlockByNumber",
        ["latest", false],
      );
      const blockNumber = hexToNumber(latest.number);
      const ageSec = Math.max(
        0,
        Math.floor(Date.now() / 1000) - hexToNumber(latest.timestamp),
      );
      const fresh = ageSec <= 120;
      checks.push({
        name: "Latest block",
        ok: fresh,
        detail: fresh
          ? `block ${blockNumber.toLocaleString("en-US")}, ${ageSec}s old`
          : `block ${blockNumber.toLocaleString("en-US")} is stale (${ageSec}s old)`,
      });
    } catch (err) {
      checks.push({
        name: "Latest block",
        ok: false,
        detail: `check failed: ${(err as Error).message}`,
      });
    }
  }

  // 3. Optional wallet balance (read-only).
  if (walletAddress !== undefined) {
    if (!isAddress(walletAddress)) {
      checks.push({
        name: "Wallet balance",
        ok: false,
        detail: `"${walletAddress}" is not a valid 0x address`,
      });
    } else if (rpcOk) {
      try {
        const balanceHex = await rpcCall<string>(rpcUrl, "eth_getBalance", [
          walletAddress,
          "latest",
        ]);
        const balanceEth = weiHexToEth(balanceHex);
        const ok = balanceEth >= minBalanceEth;
        checks.push({
          name: "Wallet balance",
          ok,
          detail: ok
            ? `${balanceEth.toFixed(6)} ETH (>= ${minBalanceEth} ETH minimum)`
            : `${balanceEth.toFixed(6)} ETH is below the ${minBalanceEth} ETH minimum — low gas`,
        });
      } catch (err) {
        checks.push({
          name: "Wallet balance",
          ok: false,
          detail: `check failed: ${(err as Error).message}`,
        });
      }
    }
  }

  // 4. Local runtime.
  checks.push({
    name: "Runtime",
    ok: true,
    detail: `Node ${process.version}, uptime ${Math.floor(process.uptime())}s`,
  });

  const failed = checks.filter((c) => !c.ok);
  const overall: HealthResult["overall"] = !rpcOk
    ? "unhealthy"
    : failed.length === 0
      ? "healthy"
      : "degraded";

  return {
    overall,
    checks,
    rpc_url: rpcUrl,
    timestamp: new Date().toISOString(),
    note: NOTE,
  };
}
