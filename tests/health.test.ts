import { describe, it, expect } from "vitest";
import app from "../src/index.js";
import type { Env } from "../src/types.js";

const env: Env = {
  CF_ACCOUNT_ID: "acct",
  CF_API_TOKEN: "token",
  API_KEYS: "test-key",
  CACHE: {} as KVNamespace,
  RATE_LIMIT: {} as KVNamespace,
};

describe("GET /health", () => {
  it("returns 200 with status ok and version", async () => {
    const res = await app.fetch(new Request("http://localhost/health"), env);
    expect(res.status).toBe(200);
    const body = await res.json<{ status: string; version: string }>();
    expect(body.status).toBe("ok");
    expect(body.version).toBe("3.1.0");
  });

  it("reports that persistent binary caching is disabled without R2", async () => {
    const res = await app.fetch(new Request("http://localhost/health"), env);
    const body = await res.json<{ capabilities: { r2_storage: boolean } }>();
    expect(body.capabilities.r2_storage).toBe(false);
  });

  it("reports R2 when the optional binding is present", async () => {
    const res = await app.fetch(new Request("http://localhost/health"), {
      ...env,
      STORAGE: {} as R2Bucket,
    });
    const body = await res.json<{ capabilities: { r2_storage: boolean } }>();
    expect(body.capabilities.r2_storage).toBe(true);
  });

  it("does not require Authorization", async () => {
    const res = await app.fetch(new Request("http://localhost/health"), env);
    expect(res.status).toBe(200);
  });
});

describe("404 fallback", () => {
  it("returns 404 JSON for unknown routes", async () => {
    const res = await app.fetch(
      new Request("http://localhost/does-not-exist", {
        headers: { Authorization: "Bearer test-key" },
      }),
      env
    );
    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Not found");
  });
});
