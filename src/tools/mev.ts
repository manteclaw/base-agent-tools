/**
 * MEV risk scan — TypeScript port of the mev-protection-scanner skill
 * (scripts/mev_scanner.py), minus the Alchemy key: it reads the public
 * Base RPC instead.
 *
 * Two modes, exactly as in the original:
 * - check: analyze a mined transaction for sandwich/frontrunning risk by
 *   looking for similar transactions (same function selector + same target)
 *   in the blocks immediately before and after it.
 * - simulate: model sandwich profitability for a planned trade size.
 *
 * Scoring mirrors the original exactly (DEX interaction +10, gas > 0.5
 * gwei +15, sandwich pattern both sides +50, frontrun setup +20, large
 * input data +10; levels CRITICAL > 80, HIGH > 60, MEDIUM > 40, else LOW).
 *
 * Honest limits: this is heuristic pattern-matching on surrounding blocks,
 * not a bot registry — the original's bot-pattern list was a placeholder
 * (the zero address) and its "ML filter, <5% false positives" claim is
 * not backed by anything in the shipped code, so the plugin does not
 * repeat it. The simulation is arithmetic, not a forked-environment
 * simulation.
 */
import { hexToNumber, rpcCall, weiHexToGwei } from "../rpc.js";

// Known DEX router addresses on Base (from the original skill).
const UNISWAP_V3_ROUTER = "0x2626664c2603336e57b271c5c0b26f421741e481";
const AERODROME_ROUTER = "0xcf77a3ba9a5ca399b7b97c77d8a436091617385b";
const KNOWN_DEX_ROUTERS = new Set([UNISWAP_V3_ROUTER, AERODROME_ROUTER]);

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface MevCheckResult {
  tx_hash: string;
  risk_score: number;
  risk_level: RiskLevel;
  indicators: string[];
  block_number: number;
  gas_price_gwei: number;
  to_address: string;
  recommendations: string[];
  error?: undefined;
}

export interface MevCheckError {
  error: string;
}

export interface SandwichSimulation {
  victim_trade_size: number;
  slippage_tolerance: number;
  extracted_value: number;
  attacker_gas_cost: number;
  attacker_profit: number;
  profitable: boolean;
  risk_to_user: "LOW" | "MEDIUM" | "HIGH";
}

interface RpcTransaction {
  from?: string;
  to?: string;
  value?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: string;
  input?: string;
  blockNumber?: string | null;
}

interface RpcBlock {
  transactions?: Array<{
    hash?: string;
    from?: string;
    to?: string;
    value?: string;
    gasPrice?: string;
    input?: string;
  }>;
}

function riskLevel(score: number): RiskLevel {
  if (score > 80) return "CRITICAL";
  if (score > 60) return "HIGH";
  if (score > 40) return "MEDIUM";
  return "LOW";
}

function recommendationsFor(score: number): string[] {
  const recs: string[] = [];
  if (score > 80) {
    recs.push("CRITICAL: Use Flashbots Protect or MEV Blocker RPC");
    recs.push("CRITICAL: Split this trade into smaller chunks");
    recs.push("CRITICAL: Consider waiting for lower congestion");
  }
  if (score > 60) {
    recs.push("Set max slippage to 0.3% or lower");
    recs.push("Use tight deadline (next 3 blocks)");
    recs.push("Consider private mempool submission");
  }
  if (score > 40) {
    recs.push("Enable slippage protection");
    recs.push("Monitor mempool before executing");
  }
  recs.push("Always verify recipient contract address");
  recs.push("Use base_gas_predict for optimal timing");
  return recs;
}

export async function checkTransaction(
  rpcUrl: string,
  txHash: string,
): Promise<MevCheckResult | MevCheckError> {
  const tx = await rpcCall<RpcTransaction | null>(
    rpcUrl,
    "eth_getTransactionByHash",
    [txHash],
    10_000,
    { allowNull: true },
  );
  if (!tx) {
    return { error: "Transaction not found" };
  }
  if (!tx.blockNumber) {
    return { error: "Transaction still pending" };
  }

  const blockNum = hexToNumber(tx.blockNumber);
  const [prevBlock, nextBlock] = await Promise.all([
    rpcCall<RpcBlock>(rpcUrl, "eth_getBlockByNumber", [`0x${(blockNum - 1).toString(16)}`, true]),
    rpcCall<RpcBlock>(rpcUrl, "eth_getBlockByNumber", [`0x${(blockNum + 1).toString(16)}`, true]),
  ]);

  const input = tx.input ?? "";
  const selector = input.slice(0, 10);
  const to = (tx.to ?? "").toLowerCase();
  // Effective gas price: gasPrice for legacy txs, maxFeePerGas for type-2.
  // Some RPC responses report gasPrice as 0x0 for type-2 txs — fall back
  // to maxFeePerGas in that case too.
  const gasPriceGwei =
    tx.gasPrice !== undefined && tx.gasPrice !== "0x0"
      ? weiHexToGwei(tx.gasPrice)
      : tx.maxFeePerGas !== undefined
        ? weiHexToGwei(tx.maxFeePerGas)
        : 0;

  let riskScore = 0;
  const indicators: string[] = [];

  if (KNOWN_DEX_ROUTERS.has(to)) {
    riskScore += 10;
    indicators.push("DEX interaction");
  }
  if (gasPriceGwei > 0.5) {
    riskScore += 15;
    indicators.push("High gas price (possible gas auction)");
  }

  const isSimilar = (t: NonNullable<RpcBlock["transactions"]>[number]): boolean =>
    (t.input ?? "").slice(0, 10) === selector &&
    (t.to ?? "").toLowerCase() === to &&
    selector !== "0x" &&
    selector !== "";
  const similarPrev = (prevBlock.transactions ?? []).filter(isSimilar);
  const similarNext = (nextBlock.transactions ?? []).filter(isSimilar);

  if (similarPrev.length > 0 && similarNext.length > 0) {
    riskScore += 50;
    indicators.push("Sandwich pattern detected (similar txs before/after)");
  } else if (similarPrev.length > 0) {
    riskScore += 20;
    indicators.push("Possible frontrunning setup");
  }

  if (input.length > 200) {
    riskScore += 10;
    indicators.push("Large input data - check slippage settings");
  }

  riskScore = Math.min(100, Math.max(0, riskScore));

  return {
    tx_hash: txHash,
    risk_score: riskScore,
    risk_level: riskLevel(riskScore),
    indicators,
    block_number: blockNum,
    gas_price_gwei: Math.round(gasPriceGwei * 10_000) / 10_000,
    to_address: tx.to ?? "",
    recommendations: recommendationsFor(riskScore),
  };
}

/**
 * Simplified sandwich model from the original: an attacker extracts
 * roughly the slippage percentage of the victim's trade, minus a rough
 * 0.001 ETH gas cost (the original's constant, kept as-is).
 */
export function simulateSandwich(
  victimAmountEth: number,
  slippagePct = 0.5,
): SandwichSimulation {
  const extraction = victimAmountEth * (slippagePct / 100);
  const attackerCost = 0.001;
  const profit = extraction - attackerCost;
  return {
    victim_trade_size: victimAmountEth,
    slippage_tolerance: slippagePct,
    extracted_value: Math.round(extraction * 10_000) / 10_000,
    attacker_gas_cost: attackerCost,
    attacker_profit: Math.round(profit * 10_000) / 10_000,
    profitable: profit > 0,
    risk_to_user: profit > 1 ? "HIGH" : profit > 0.1 ? "MEDIUM" : "LOW",
  };
}
