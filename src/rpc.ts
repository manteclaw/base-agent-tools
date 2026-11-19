/**
 * Minimal JSON-RPC client for the public Base endpoint.
 * No API keys, no signing, no transaction submission — read-only calls only.
 */

export const DEFAULT_RPC_URL = "https://mainnet.base.org";
export const BASE_CHAIN_ID = 8453;

export class RpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcError";
  }
}

export async function rpcCall<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
  timeoutMs = 10_000,
  opts?: { allowNull?: boolean },
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new RpcError(`Base RPC HTTP ${res.status} for ${method}`);
    }
    const data = (await res.json()) as {
      result?: T;
      error?: { message?: string; code?: number };
    };
    if (data.error) {
      throw new RpcError(
        `Base RPC ${method} error ${data.error.code ?? ""}: ${data.error.message ?? "unknown"}`,
      );
    }
    if (data.result === undefined || data.result === null) {
      if (opts?.allowNull) return null as T;
      throw new RpcError(`Base RPC ${method} returned no result`);
    }
    return data.result;
  } catch (err) {
    if (err instanceof RpcError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new RpcError(`Base RPC ${method} timed out after ${timeoutMs}ms`);
    }
    throw new RpcError(`Base RPC ${method} failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

export function hexToBigInt(hex: string): bigint {
  if (!hex) return 0n;
  return BigInt(hex.startsWith("0x") ? hex : `0x${hex}`);
}

export function hexToNumber(hex: string): number {
  return Number(hexToBigInt(hex));
}

/** Wei (as a hex string) -> ETH as a float. */
export function weiHexToEth(hex: string): number {
  return Number(hexToBigInt(hex)) / 1e18;
}

/** Wei (as a hex string) -> gwei as a float. */
export function weiHexToGwei(hex: string): number {
  return Number(hexToBigInt(hex)) / 1e9;
}

/** Gwei as a float -> gwei rounded to 6 decimals. */
export function roundGwei(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
