/**
 * Shared fakes for the Worker's bindings.
 *
 * These are intentionally in-memory and dumb: the tests care about the
 * Worker's own logic, not about KV or R2 semantics.
 */
import { vi } from "vitest";
import type { Env } from "../src/types.js";

export function makeKv(): KVNamespace {
  const store = new Map<string, { value: string; metadata: unknown }>();
  return {
    get: async (key: string) => store.get(key)?.value ?? null,
    getWithMetadata: async (key: string) => ({
      value: store.get(key)?.value ?? null,
      metadata: store.get(key)?.metadata ?? null,
      cacheStatus: null,
    }),
    put: async (key: string, value: string, opts?: { metadata?: unknown }) => {
      store.set(key, { value, metadata: opts?.metadata ?? null });
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async () => ({ keys: [], list_complete: true, cursor: "", cacheStatus: null }),
  } as unknown as KVNamespace;
}

export function makeR2(): R2Bucket {
  const store = new Map<string, ArrayBuffer | string>();
  return {
    get: async (key: string) => {
      const item = store.get(key);
      if (item === undefined) return null;
      return {
        arrayBuffer: async () =>
          typeof item === "string" ? new TextEncoder().encode(item).buffer : item,
        httpMetadata: { contentType: "application/octet-stream" },
        customMetadata: {},
      };
    },
    put: async (key: string, body: ArrayBuffer | string) => {
      store.set(key, body);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async () => ({ objects: [], truncated: false }),
    head: async () => null,
  } as unknown as R2Bucket;
}

/**
 * A minimally configured Env: an API key and KV, but no Cloudflare API
 * credentials, R2 storage, browser binding or AI. That's the baseline "just
 * deployed it" state, and several tests depend on the Worker still working
 * there without enabling a paid subscription.
 */
export function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    API_KEYS: "valid-key",
    CACHE: makeKv(),
    RATE_LIMIT: makeKv(),
    ...overrides,
  };
}

/** Env with Browser Rendering REST credentials. */
export function restEnv(overrides: Partial<Env> = {}): Env {
  return baseEnv({
    CF_ACCOUNT_ID: "test-account",
    CF_API_TOKEN: "test-token",
    ...overrides,
  });
}

/** A stub AI binding that echoes a canned completion. */
export function makeAiBinding(response: string) {
  return {
    run: vi.fn(async () => ({ response })),
  };
}

export const DNS_PUBLIC_IP = "93.184.216.34";

export function dnsResponse(ip = DNS_PUBLIC_IP): Response {
  return new Response(JSON.stringify({ Answer: [{ data: ip }] }), {
    status: 200,
    headers: { "Content-Type": "application/dns-json" },
  });
}
