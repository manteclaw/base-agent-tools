/**
 * Base gas prediction — TypeScript port of the gas-price-predictor skill
 * (scripts/gas_predictor.py), minus the Alchemy key: it reads the public
 * Base RPC instead.
 *
 * Method, faithful to the original:
 * - `eth_feeHistory` gives the base fee of the last N blocks plus the next
 *   block's fee (what a new transaction would pay).
 * - Average the window; compare current vs average. Ratio > 1.5 = high
 *   congestion + wait; > 1.2 = medium; otherwise low.
 * - Confidence: high -> min(95, ratio * 30); medium -> 60; low -> 85.
 * - Priority fee: min(0.001, current * 0.05) gwei (conservative, as in the
 *   original).
 * - Cost estimate is for a standard 21,000-gas transfer, priced at the
 *   caller-supplied ETH price (default 3000) — that is an assumption, not
 *   a live quote.
 *
 * One fix vs the original: `gas_predictor.py` calls `analyze_patterns()`
 * in its --analyze path but never defines it, so that path crashes. The
 * window statistics (avg/min/max) are computed inline here.
 */
import {
  RpcError,
  hexToBigInt,
  hexToNumber,
  roundGwei,
  rpcCall,
} from "../rpc.js";

export type Congestion = "low" | "medium" | "high";

export interface GasPrediction {
  current_base_fee_gwei: number;
  recommended_priority_gwei: number;
  total_gas_price_gwei: number;
  congestion: Congestion;
  wait_recommended: boolean;
  estimated_cost_usd: number;
  confidence: number;
  avg_base_fee_gwei: number;
  min_base_fee_gwei: number;
  max_base_fee_gwei: number;
  ratio_to_avg: number;
  blocks_analyzed: number;
  block_number: number;
  block_utilization_pct: number;
  utc_hour_window: string;
  eth_price_usd_assumed: number;
  rpc_url: string;
  timestamp: string;
}

interface FeeHistory {
  oldestBlock: string;
  baseFeePerGas: string[];
}

interface BlockHeader {
  number: string;
  timestamp: string;
  gasUsed: string;
  gasLimit: string;
}

function utcHourWindow(hourUtc: number): string {
  if (hourUtc >= 2 && hourUtc < 6) return "02:00-06:00 UTC — typically low, best window for non-urgent txs";
  if (hourUtc >= 8 && hourUtc < 12) return "08:00-12:00 UTC — typically medium, standard operations";
  if (hourUtc >= 14 && hourUtc < 18) return "14:00-18:00 UTC — typically high, avoid if possible";
  if (hourUtc >= 20) return "20:00-00:00 UTC — typically medium-high, acceptable for urgent txs";
  return "off-peak shoulder hours — typically low to medium";
}

export async function predictGas(
  rpcUrl: string,
  blocks: number,
  ethPriceUsd: number,
): Promise<GasPrediction> {
  const [history, latest] = await Promise.all([
    rpcCall<FeeHistory>(rpcUrl, "eth_feeHistory", [blocks, "latest", []]),
    rpcCall<BlockHeader>(rpcUrl, "eth_getBlockByNumber", ["latest", false]),
  ]);

  const fees = history.baseFeePerGas;
  if (fees.length < 2) {
    throw new RpcError("Base RPC returned too little fee history");
  }
  // eth_feeHistory returns one fee per requested block PLUS the next block's
  // fee as the final element. The final element is what a new tx would pay.
  const windowFees = fees.slice(0, -1).map((f) => Number(hexToBigInt(f)) / 1e9);
  const current = Number(hexToBigInt(fees[fees.length - 1])) / 1e9;
  if (windowFees.length === 0 || !(current > 0)) {
    throw new RpcError("Base RPC returned unusable fee data");
  }

  const sum = windowFees.reduce((a, b) => a + b, 0);
  const avg = sum / windowFees.length;
  const min = Math.min(...windowFees);
  const max = Math.max(...windowFees);
  const ratio = avg > 0 ? current / avg : 1;

  let congestion: Congestion;
  let waitRecommended: boolean;
  let confidence: number;
  if (ratio > 1.5) {
    congestion = "high";
    waitRecommended = true;
    confidence = Math.min(95, Math.floor(ratio * 30));
  } else if (ratio > 1.2) {
    congestion = "medium";
    waitRecommended = false;
    confidence = 60;
  } else {
    congestion = "low";
    waitRecommended = false;
    confidence = 85;
  }

  const priorityFee = Math.min(0.001, current * 0.05);
  const totalGasGwei = current + priorityFee;
  const costEth = (21_000 * totalGasGwei) / 1e9;
  const costUsd = costEth * ethPriceUsd;

  const blockNumber = hexToNumber(latest.number);
  const gasUsed = hexToBigInt(latest.gasUsed);
  const gasLimit = hexToBigInt(latest.gasLimit);
  const utilization =
    gasLimit > 0n ? Math.round((Number(gasUsed) / Number(gasLimit)) * 1000) / 10 : 0;

  return {
    current_base_fee_gwei: roundGwei(current),
    recommended_priority_gwei: roundGwei(priorityFee),
    total_gas_price_gwei: roundGwei(totalGasGwei),
    congestion,
    wait_recommended: waitRecommended,
    estimated_cost_usd: Math.round(costUsd * 10_000) / 10_000,
    confidence,
    avg_base_fee_gwei: roundGwei(avg),
    min_base_fee_gwei: roundGwei(min),
    max_base_fee_gwei: roundGwei(max),
    ratio_to_avg: Math.round(ratio * 100) / 100,
    blocks_analyzed: windowFees.length,
    block_number: blockNumber,
    block_utilization_pct: utilization,
    utc_hour_window: utcHourWindow(new Date().getUTCHours()),
    eth_price_usd_assumed: ethPriceUsd,
    rpc_url: rpcUrl,
    timestamp: new Date().toISOString(),
  };
}
