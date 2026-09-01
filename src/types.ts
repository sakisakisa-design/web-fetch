export type Env = {
  // --- Secrets -------------------------------------------------------------
  /** Comma-separated list of API keys accepted by this Worker. Required. */
  API_KEYS: string;
  /**
   * Optional override. When unset, the Worker looks the account ID up from
   * CF_API_TOKEN via GET /accounts. Only needed if that token can see more
   * than one account.
   */
  CF_ACCOUNT_ID?: string;
  /**
   * One Cloudflare API token. Unlocks Browser Rendering REST *and* authenticates
   * AI Gateway (Unified Billing / BYOK). Account ID is detected from it.
   */
  CF_API_TOKEN?: string;
  /** Optional. Only if you still pass a provider key through the gateway yourself. */
  AI_PROVIDER_KEY?: string;
  /** Optional. Defaults to CF_API_TOKEN — you do not need a second Cloudflare token. */
  AI_GATEWAY_TOKEN?: string;

  // --- Vars ----------------------------------------------------------------
  /** AI Gateway ID. When set, compression routes through the Gateway. */
  AI_GATEWAY_ID?: string;
  /** Optional. Falls back to CF_ACCOUNT_ID, then to auto-detect from the token. */
  AI_GATEWAY_ACCOUNT_ID?: string;
  /**
   * Model for compression. `{provider}/{model}` for the unified chat API;
   * the provider's own bare model id for the `responses` / `messages` styles.
   */
  AI_MODEL?: string;
  /**
   * Which API shape the model speaks: `chat` (default, AI Gateway's unified
   * endpoint), `responses` (OpenAI Responses API), or `messages` (Anthropic
   * Messages API).
   */
  AI_API_STYLE?: string;
  /** Fallback model id used with the Workers AI binding. */
  WORKERS_AI_MODEL?: string;
  /** Token count above which content is auto-compressed. Default 8000. */
  COMPRESS_THRESHOLD?: string;
  /** Token count above which a `query` triggers extraction. Default 800. */
  COMPRESS_QUERY_MIN?: string;
  /** `full` (default) or `minimal` — how many tools /mcp advertises. */
  MCP_TOOLSET?: string;

  // --- Bindings ------------------------------------------------------------
  CACHE: KVNamespace;
  RATE_LIMIT: KVNamespace;
  /** Optional R2 storage for binary and completed-crawl caching. */
  STORAGE?: R2Bucket;
  /** Browser Rendering binding — needed for interaction + puppeteer PDF. */
  BROWSER?: Fetcher;
  /** Workers AI binding — compression fallback when no Gateway is configured. */
  AI?: { run: (model: string, inputs: unknown, options?: unknown) => Promise<unknown> };
};

export type Variables = {
  apiKey: string;
};

export type AppEnv = { Bindings: Env; Variables: Variables };

// Optional cookies for authenticated browsing
export type CookieParam = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

// Script/Style tag injection (CF API format)
export type ScriptTag = { content?: string; url?: string };
export type StyleTag = { content?: string; url?: string };

// Base request body all POST routes accept.
//
// User-facing params use snake_case; mapToCfParams() translates them
// to the camelCase equivalents the CF Browser Rendering REST API expects:
//   wait_for             → waitForSelector
//   headers              → setExtraHTTPHeaders
//   timeout              → gotoOptions.timeout
//   wait_until           → gotoOptions.waitUntil
//   user_agent           → userAgent
//   add_script_tag       → addScriptTag
//   add_style_tag        → addStyleTag
//   reject_resource_types → rejectResourceTypes
export type BaseRequestBody = {
  url: string;
  no_cache?: boolean;
  cookies?: CookieParam[];              // inject cookies before page load
  headers?: Record<string, string>;     // → setExtraHTTPHeaders
  wait_for?: string;                    // → waitForSelector
  timeout?: number;                     // → gotoOptions.timeout
  wait_until?: string;                  // → gotoOptions.waitUntil
  user_agent?: string;                  // → userAgent
  add_script_tag?: ScriptTag[];         // → addScriptTag (inject JS)
  add_style_tag?: StyleTag[];           // → addStyleTag (inject CSS)
  reject_resource_types?: string[];     // → rejectResourceTypes (block images, etc.)
  authenticate?: { username: string; password: string }; // HTTP Basic Auth (pass-through)
};

// Endpoint-specific option types

export type ContentRequestBody = BaseRequestBody;

export type ScreenshotRequestBody = BaseRequestBody & {
  width?: number;
  height?: number;
  full_page?: boolean;
};

export type PdfRequestBody = BaseRequestBody & {
  format?: "A4" | "Letter" | "A3" | "A5" | "Legal" | "Tabloid";
  landscape?: boolean;
};

export type MarkdownRequestBody = BaseRequestBody;

export type SnapshotRequestBody = BaseRequestBody;

export type ScrapeRequestBody = BaseRequestBody & {
  elements?: string[];  // CSS selectors to extract
};

export type JsonRequestBody = BaseRequestBody & {
  schema?: Record<string, unknown>;
  prompt?: string;
};

export type LinksRequestBody = BaseRequestBody & {
  include_external?: boolean;
};

export type CrawlRequestBody = BaseRequestBody & {
  limit?: number;       // max pages to crawl (CF API param)
  max_pages?: number;   // alias for limit (user-friendly)
};

export type A11yRequestBody = BaseRequestBody;

// Interaction endpoint types (require BROWSER binding)

export type ClickRequestBody = BaseRequestBody & {
  selector: string;
};

export type TypeRequestBody = BaseRequestBody & {
  selector: string;
  text: string;
  clear?: boolean;
};

export type EvaluateRequestBody = BaseRequestBody & {
  script: string;
};

export type SubmitFormRequestBody = BaseRequestBody & {
  fields: Record<string, string>; // selector → value
  submit_selector?: string;
};

export type InteractAction =
  | { action: "navigate"; url: string }
  | { action: "click"; selector: string }
  | { action: "type"; selector: string; text: string; clear?: boolean }
  | { action: "wait"; selector: string; timeout?: number }
  | { action: "screenshot" }
  | { action: "evaluate"; script: string }
  | { action: "select"; selector: string; value: string }
  | { action: "scroll"; x?: number; y?: number };

export type InteractRequestBody = BaseRequestBody & {
  actions: InteractAction[];
};

// --- web_fetch (the headline tool) ------------------------------------------

/** How a page is retrieved. */
export type FetchMode =
  /** Plain HTTP fetch first; escalate to browser rendering if the result looks empty. */
  | "auto"
  /** Plain HTTP fetch only — fastest, no browser time consumed. */
  | "fetch"
  /** Always render in a headless browser. */
  | "browser";

/** How the retrieved content is post-processed before being returned. */
export type CompressMode =
  /** Compress only when the content exceeds the configured threshold. */
  | "auto"
  /** Never call the model; always return the full content. */
  | "off"
  /** Always compress, regardless of length. */
  | "on";

export type FetchRequestBody = BaseRequestBody & {
  mode?: FetchMode;
  compress?: CompressMode;
  /** When present, compression keeps only what answers this question. */
  query?: string;
  /** Output shape. `markdown` (default), `text`, or raw `html`. */
  format?: "markdown" | "text" | "html";
  /** Hard cap on returned characters, applied after compression. */
  max_chars?: number;
};

export type FetchResult = {
  url: string;
  /** Final URL after redirects, when it differs from the requested one. */
  final_url?: string;
  title?: string;
  content: string;
  /** Which retrieval path actually produced the content. */
  retrieved_via: "fetch" | "browser";
  /** Present when the model rewrote the content. */
  compression?: {
    model: string;
    query?: string;
    original_chars: number;
    output_chars: number;
    /** Set when input was truncated to stay within the chunk budget. */
    truncated?: boolean;
  };
  /** Non-fatal problems the caller should know about. */
  warnings?: string[];
};

// Unified error response
export type ErrorResponse = {
  error: string;
  status: number;
};

// Cache metadata stored alongside KV entries
export type CacheMeta = {
  content_type: string;
  cached_at: number;
  ttl: number;
};
