# web-fetch

A web-reading tool for AI agents, running on Cloudflare Workers.

Deploy it once, then Claude Code, Cursor, or any Streamable HTTP MCP client can read web pages with a Worker URL and an API key.

[中文说明](README.zh-CN.md)

## Easiest deployment: fork and connect GitHub

This path does **not** require Node.js, npm, or Wrangler on your computer.

1. Open [sakisakisa-design/web-fetch](https://github.com/sakisakisa-design/web-fetch) and click **Fork**.
2. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com).
3. Open **Workers & Pages → Create → Import a repository**.
4. Click **Connect GitHub** if this is your first time, authorize Cloudflare, and select your fork.
5. Keep the default build settings and click **Deploy**.

The first build creates the KV bindings without requiring resource IDs. The default configuration deliberately does **not** enable R2, so deployment does not require an R2 subscription or payment method. Core `web_fetch`, screenshots, PDFs, and crawls still run; binary responses and completed crawls are simply not persisted. Browser and Workers AI bindings work when those capabilities are available on the Cloudflare account. Future pushes to your fork's `main` branch redeploy automatically.

Cloudflare will give you a URL like:

```text
https://web-fetch.<your-subdomain>.workers.dev
```

## Environment variables

After deployment, open:

**Workers & Pages → web-fetch → Settings → Variables and Secrets**

Click **Add**. Use **Secret** for credentials; do not store credentials as plain Text.

### Required

| Name | Type | Value | Purpose |
|---|---|---|---|
| `API_KEYS` | Secret | A long random string you generate | The password clients use to access this Worker |

`API_KEYS` is not an OpenAI key and not a Cloudflare API token. It is the access password for your own Worker. Multiple keys can be comma-separated.

### Recommended: Cloudflare API token

| Name | Type | Value | Purpose |
|---|---|---|---|
| `CF_API_TOKEN` | Secret | A Cloudflare API token | Enables screenshots, PDFs, crawls, AI extraction, and account-ID auto-detection |

Create it at [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens): **Create Token → Edit Cloudflare Workers**. Plain web fetching still works without it. Do not paste an OpenAI, Anthropic, or Gemini key here.

### AI Gateway compression

Long pages are compressed before being returned to the agent. Without an AI Gateway, the Worker uses the Workers AI model `@cf/meta/llama-3.1-8b-instruct-fast`.

The recommended model is `gpt-5.6-luna`. It is **Responses API only**, so configure it like this:

| Name | Type | Example | Meaning |
|---|---|---|---|
| `AI_GATEWAY_ID` | Text | `my-gateway` | The Gateway name created in Cloudflare AI Gateway |
| `AI_MODEL` | Text | `gpt-5.6-luna` | The provider's bare model ID for Responses mode |
| `AI_API_STYLE` | Text | `responses` | The request format; required for `gpt-5.6-luna` |
| `CF_API_TOKEN` | Secret | Your Cloudflare token | Authenticates AI Gateway and can identify the account |

You can enable Unified Billing or store provider credentials on the Gateway with BYOK. Normally you do not need a separate provider key.

`AI_API_STYLE` supports three values:

| Value | Use it for | `AI_MODEL` format |
|---|---|---|
| `chat` | Most Chat Completions-compatible models | `openai/gpt-5-mini`, `google-ai-studio/gemini-2.5-flash` |
| `responses` | Responses-only models such as `gpt-5.6-luna` | Bare ID such as `gpt-5.6-luna` |
| `messages` | Anthropic's native Messages API | Bare Anthropic model ID such as `claude-haiku-4-5` |

### Other optional variables

| Name | Default | Meaning |
|---|---|---|
| `AI_GATEWAY_ACCOUNT_ID` | Auto-detected | Account ID for the AI Gateway; usually unnecessary |
| `AI_PROVIDER_KEY` | Empty | Direct provider key; usually unnecessary with Gateway Unified Billing/BYOK |
| `AI_GATEWAY_TOKEN` | Uses `CF_API_TOKEN` | Separate Gateway token; normally reuse `CF_API_TOKEN` |
| `CF_ACCOUNT_ID` | Auto-detected | Cloudflare account ID; usually unnecessary |
| `WORKERS_AI_MODEL` | `@cf/meta/llama-3.1-8b-instruct-fast` | Workers AI fallback model |
| `COMPRESS_THRESHOLD` | `8000` | Approximate page size at which automatic compression starts |
| `COMPRESS_QUERY_MIN` | `800` | Approximate size at which query-directed extraction starts |
| `MCP_TOOLSET` | `full` | `minimal` advertises only core reading tools |

For a first deployment, configure only `API_KEYS` and `CF_API_TOKEN`. Add Gateway variables after basic fetching works.

## Check the deployment

Open this public endpoint in a browser:

```text
https://<your-worker>.workers.dev/health
```

It reports the active capabilities, optional R2 storage, compression backend, model, and missing configuration.

## Connect an MCP client

```json
{
  "mcpServers": {
    "web-fetch": {
      "type": "http",
      "url": "https://<your-worker>.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer <your-API_KEYS-value>"
      }
    }
  }
}
```

The URL must end in `/mcp`. The key here is the value from `API_KEYS`, not `CF_API_TOKEN` or a provider key.

Clients without MCP can call the HTTP endpoint:

```bash
curl -X POST https://<your-worker>.workers.dev/fetch \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","query":"What is this page about?"}'
```

## Tools

| Tool | Does | Needs |
|---|---|---|
| `web_fetch` | Read a page as Markdown | Nothing |
| `web_screenshot` | Take a screenshot | Browser binding or `CF_API_TOKEN` |
| `web_pdf` | Render a PDF | Browser binding or `CF_API_TOKEN` |
| `web_extract` | Extract structured JSON | `CF_API_TOKEN` |
| `web_links` / `web_scrape` / `web_a11y` | Links, CSS extraction, accessibility tree | `CF_API_TOKEN` |
| `web_crawl` | Crawl multiple pages | `CF_API_TOKEN` |
| `web_click` / `web_type` / `web_evaluate` / `web_submit_form` | Interact with a page | Browser binding |

Tools unavailable to the deployment are hidden from MCP discovery. Set `MCP_TOOLSET=minimal` to advertise only core reading tools.

## Troubleshooting

- If `/health` says `API_KEYS` is missing, check the spelling, make sure it is a Secret, save it, and wait for redeployment.
- `r2_storage: false` is the normal default and means persistent binary/crawl caching is off; core fetching still works without an R2 subscription.
- If browser tools are missing, check the Browser binding and `CF_API_TOKEN`.
- If Gateway compression is disabled, check `AI_GATEWAY_ID`, `AI_MODEL`, `AI_API_STYLE`, and `CF_API_TOKEN`. For `gpt-5.6-luna`, use `responses`.
- A `429` means the rate limit was reached; each API key allows up to 60 requests per minute by default.

## Local development (optional)

Only needed if you want to modify the code locally. Requires Node.js 18+:

```bash
npm install
npm run dev
npm test
npm run type-check
```

Local secrets go in the gitignored `.dev.vars` file.

## Security and license

Credentials must not be committed to GitHub or pasted into public messages. Prefer the `Authorization` header instead of putting keys in URLs. The project is MIT licensed.
