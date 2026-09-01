/**
 * web-fetch — a portable web reading tool for AI agents.
 *
 * One Cloudflare Worker exposes three surfaces over the same core:
 *
 *   POST /mcp     Model Context Protocol (Streamable HTTP) — the primary one.
 *                 Any MCP client, anywhere, needs only this URL and a key.
 *   POST /fetch   The `web_fetch` tool as plain REST, for agents without MCP.
 *   POST /<tool>  The original per-capability REST endpoints.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv } from "./types.js";
import { authMiddleware, mcpAuthMiddleware } from "./middleware/auth.js";
import { rateLimitMiddleware } from "./middleware/rate-limit.js";
import { resolveBackend } from "./lib/ai.js";
import { hasRestCredentials } from "./lib/fetch-page.js";
import { availableTools } from "./mcp/tools.js";
import { SERVER_VERSION } from "./mcp/server.js";
import mcpRoute from "./routes/mcp.js";
import fetchRoute from "./routes/fetch.js";
import contentRoute from "./routes/content.js";
import screenshotRoute from "./routes/screenshot.js";
import pdfRoute from "./routes/pdf.js";
import markdownRoute from "./routes/markdown.js";
import snapshotRoute from "./routes/snapshot.js";
import scrapeRoute from "./routes/scrape.js";
import jsonRoute from "./routes/json.js";
import linksRoute from "./routes/links.js";
import crawlRoute from "./routes/crawl.js";
import a11yRoute from "./routes/a11y.js";
import clickRoute from "./routes/click.js";
import typeRoute from "./routes/type.js";
import evaluateRoute from "./routes/evaluate.js";
import interactRoute from "./routes/interact.js";
import submitFormRoute from "./routes/submit-form.js";

const app = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------

// CORS: wildcard origin is intentional for this API-style Worker.
// All endpoints require Bearer token auth, so unauthenticated cross-origin
// requests are rejected regardless. Teams needing tighter CORS should
// replace "*" with their specific origin domain.
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "X-API-Key", "MCP-Protocol-Version"],
    exposeHeaders: ["X-Cache", "X-RateLimit-Limit", "X-RateLimit-Remaining"],
  })
);

// ---------------------------------------------------------------------------
// Unauthenticated: health and discovery
// ---------------------------------------------------------------------------

/**
 * Reports what this particular deployment can do. Capabilities depend on which
 * secrets and bindings are present, so this is the fastest way to diagnose a
 * half-configured Worker without reading logs.
 */
app.get("/health", (c) => {
  const aiBackend = resolveBackend(c.env);
  const configured = (c.env.API_KEYS ?? "").split(",").filter((k) => k.trim()).length > 0;

  return c.json({
    status: configured ? "ok" : "setup_required",
    version: SERVER_VERSION,
    capabilities: {
      /** Plain-HTTP fetching always works; it needs no credentials at all. */
      fetch: true,
      /** Browser Rendering REST endpoints (markdown, crawl, links, AI extract). */
      rest_api: hasRestCredentials(c.env),
      /** Puppeteer interaction + paper-size PDFs. */
      browser_binding: Boolean(c.env.BROWSER),
      /** Optional persistent caching for binary responses and completed crawls. */
      r2_storage: Boolean(c.env.STORAGE),
      compression:
        aiBackend.kind === "none"
          ? { enabled: false, reason: aiBackend.reason }
          : { enabled: true, backend: aiBackend.kind, model: aiBackend.model },
    },
    mcp_tools: availableTools(c.env).map((t) => t.name),
    ...(configured
      ? {}
      : {
          setup: "openssl rand -hex 32 | npx wrangler secret put API_KEYS",
        }),
  });
});

/** Human landing page — what this is and how to point a client at it. */
app.get("/", (c) => {
  const base = new URL(c.req.url).origin;
  return c.text(
    [
      `web-fetch ${SERVER_VERSION}`,
      "",
      "A web reading tool for AI agents, served straight from a Cloudflare Worker.",
      "",
      "MCP endpoint (add this to your client):",
      `  ${base}/mcp     Authorization: Bearer <api-key>`,
      "",
      "REST:",
      `  POST ${base}/fetch  {"url": "...", "query": "optional question"}`,
      "",
      `Capabilities: ${base}/health`,
      `Schema:       ${base}/openapi.json`,
    ].join("\n"),
  );
});

/**
 * OpenAPI description of `/fetch`, so agent frameworks that import tools from
 * a schema rather than speaking MCP can use this Worker too.
 */
app.get("/openapi.json", (c) => {
  const base = new URL(c.req.url).origin;
  return c.json({
    openapi: "3.1.0",
    info: {
      title: "web-fetch",
      version: SERVER_VERSION,
      description: "Read web pages as Markdown, with optional query-directed compression.",
    },
    servers: [{ url: base }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      "/fetch": {
        post: {
          operationId: "web_fetch",
          summary: "Read a web page as Markdown",
          description:
            "Fetches a page, rendering JavaScript when needed. Pass `query` to receive only " +
            "the passages relevant to a question instead of the whole page.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["url"],
                  properties: {
                    url: { type: "string", description: "Absolute http(s) URL." },
                    query: { type: "string", description: "What you want to know from the page." },
                    mode: { type: "string", enum: ["auto", "fetch", "browser"] },
                    compress: { type: "string", enum: ["auto", "off", "on"] },
                    format: { type: "string", enum: ["markdown", "text", "html"] },
                    max_chars: { type: "number" },
                    no_cache: { type: "boolean" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Page content",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      url: { type: "string" },
                      final_url: { type: "string" },
                      title: { type: "string" },
                      content: { type: "string" },
                      retrieved_via: { type: "string", enum: ["fetch", "browser"] },
                      compression: { type: "object" },
                      warnings: { type: "array", items: { type: "string" } },
                    },
                  },
                },
              },
            },
            "400": { description: "Invalid request or blocked URL" },
            "401": { description: "Missing or invalid API key" },
          },
        },
      },
    },
  });
});

// ---------------------------------------------------------------------------
// Authenticated + rate-limited routes
// ---------------------------------------------------------------------------

// MCP authenticates first so the rate limiter can bucket per key.
app.use("/mcp", mcpAuthMiddleware, rateLimitMiddleware);
app.use("/mcp/*", mcpAuthMiddleware, rateLimitMiddleware);

app.use("/fetch/*", authMiddleware, rateLimitMiddleware);

// Read-only routes
app.use("/content/*", authMiddleware, rateLimitMiddleware);
app.use("/screenshot/*", authMiddleware, rateLimitMiddleware);
app.use("/pdf/*", authMiddleware, rateLimitMiddleware);
app.use("/markdown/*", authMiddleware, rateLimitMiddleware);
app.use("/snapshot/*", authMiddleware, rateLimitMiddleware);
app.use("/scrape/*", authMiddleware, rateLimitMiddleware);
app.use("/json/*", authMiddleware, rateLimitMiddleware);
app.use("/links/*", authMiddleware, rateLimitMiddleware);
app.use("/crawl/*", authMiddleware, rateLimitMiddleware);
app.use("/a11y/*", authMiddleware, rateLimitMiddleware);

// Interaction routes (require BROWSER binding)
app.use("/click/*", authMiddleware, rateLimitMiddleware);
app.use("/type/*", authMiddleware, rateLimitMiddleware);
app.use("/evaluate/*", authMiddleware, rateLimitMiddleware);
app.use("/interact/*", authMiddleware, rateLimitMiddleware);
app.use("/submit-form/*", authMiddleware, rateLimitMiddleware);

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

app.route("/mcp", mcpRoute);
app.route("/fetch", fetchRoute);

// Read-only
app.route("/content", contentRoute);
app.route("/screenshot", screenshotRoute);
app.route("/pdf", pdfRoute);
app.route("/markdown", markdownRoute);
app.route("/snapshot", snapshotRoute);
app.route("/scrape", scrapeRoute);
app.route("/json", jsonRoute);
app.route("/links", linksRoute);
app.route("/crawl", crawlRoute);
app.route("/a11y", a11yRoute);

// Interaction
app.route("/click", clickRoute);
app.route("/type", typeRoute);
app.route("/evaluate", evaluateRoute);
app.route("/interact", interactRoute);
app.route("/submit-form", submitFormRoute);

// ---------------------------------------------------------------------------
// 404 fallback
// ---------------------------------------------------------------------------

app.notFound((c) => {
  return c.json({ error: "Not found", status: 404 }, 404);
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  const message = err instanceof Error ? err.message : "Internal server error";
  return c.json({ error: message, status: 500 }, 500);
});

export default app;
