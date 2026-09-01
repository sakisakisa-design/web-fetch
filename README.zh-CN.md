# web-fetch

给 AI 用的网页阅读工具，跑在 Cloudflare Worker 上。

部署好以后，Claude Code、Cursor 或其他支持 MCP 的 AI 客户端，只需要一个 Worker 地址和一把访问密钥，就能读网页、截图、转 PDF、提取内容和爬取多页。

## 最简单的部署方式：Fork 后连接 GitHub

这个方法**不需要在电脑上安装 Node.js、npm 或 Wrangler**，推荐第一次使用的人走这条路。

### 1. Fork 仓库

打开 [sakisakisa-design/web-fetch](https://github.com/sakisakisa-design/web-fetch)，点击右上角 **Fork**，把项目复制到你自己的 GitHub 账号下面。

### 2. 在 Cloudflare 连接 GitHub

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)。
2. 打开 **Workers & Pages**。
3. 点击 **Create**。
4. 选择 **Import a repository**。
5. 第一次使用时，点击 **Connect GitHub**，授权 Cloudflare 访问 GitHub。
6. 选择你刚刚 Fork 的 `web-fetch` 仓库。
7. 保持默认构建设置，点击 **Deploy**。

第一次构建会创建项目需要的 KV 绑定，不需要自己填写资源 ID。默认配置**不会启用 R2**，因此不需要开通 R2 订阅或绑定银行卡；普通 `web_fetch`、截图、PDF 和 crawl 仍可运行，只是二进制结果与已完成 crawl 不会持久缓存。Browser 和 Workers AI 绑定按 Cloudflare 账号可用能力生效。部署成功后，Cloudflare 会给你一个地址，例如：

```text
https://web-fetch.你的子域.workers.dev
```

以后你向自己 Fork 的仓库 `main` 分支推送更新，Cloudflare 会自动重新部署。

## 部署后必须填写的环境变量

进入 Cloudflare：

**Workers & Pages → web-fetch → Settings → Variables and Secrets**

点击 **Add** 添加变量。密钥类变量请选择 **Secret**，不要选普通的 Text。

### 必填变量

| 变量名 | 类型 | 填什么 | 用途 |
|---|---|---|---|
| `API_KEYS` | Secret | 自己生成的一串长随机字符串 | 访问 Worker 的密码。MCP 客户端连接时要用它 |

例如：

```text
API_KEYS=一串至少几十位的随机字符
```

这不是 OpenAI key，也不是 Cloudflare API token，而是你自己给这个 Worker 设置的访问密码。想设置多把密码时，用英文逗号分隔：

```text
key-for-me,key-for-friend
```

### 推荐填写：Cloudflare API Token

| 变量名 | 类型 | 填什么 | 用途 |
|---|---|---|---|
| `CF_API_TOKEN` | Secret | Cloudflare API Token | 开启截图、PDF、多页爬取、AI 抽取等 Cloudflare Browser Rendering 功能；也可用于自动识别账号 ID |

创建方法：

1. 打开 [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)。
2. 点击 **Create Token**。
3. 选择 **Edit Cloudflare Workers** 模板。
4. 创建后复制 token，粘贴到 `CF_API_TOKEN` 的 Secret 值里。

普通网页读取不填这个也能用。注意：这里填的是 **Cloudflare token**，不是 OpenAI、Claude 或 Gemini 的 key。

## AI 压缩配置（推荐使用 gpt-5.6-luna）

网页太长时，web-fetch 会把内容压缩成适合 AI 阅读的摘要。默认使用 Cloudflare Workers AI 的小模型；如果你已经在 Cloudflare AI Gateway 里配置了模型，推荐使用 `gpt-5.6-luna`。

`gpt-5.6-luna` 是 **Responses API only** 模型，因此必须设置：

| 变量名 | 类型 | 示例值 | 说明 |
|---|---|---|---|
| `AI_GATEWAY_ID` | Text | `my-gateway` | 你在 Cloudflare AI Gateway 创建的 Gateway 名称 |
| `AI_MODEL` | Text | `gpt-5.6-luna` | Responses 模式使用模型自己的裸 ID，不加 `openai/` 前缀；以 Gateway 中显示的名称为准 |
| `AI_API_STYLE` | Text | `responses` | API 格式。`gpt-5.6-luna` 必须填 `responses` |
| `CF_API_TOKEN` | Secret | 你的 Cloudflare token | 用于访问 AI Gateway，并自动识别账号 ID |

配置示例：

```text
AI_GATEWAY_ID=my-gateway
AI_MODEL=gpt-5.6-luna
AI_API_STYLE=responses
```

同时确保 `CF_API_TOKEN` 已经填写。AI Gateway 里可以开启 Unified Billing，或使用 BYOK 保存供应商密钥。正常情况下不需要再额外填 OpenAI key。

### `AI_API_STYLE` 三种取值

| 值 | 适用模型 | `AI_MODEL` 应该怎么写 |
|---|---|---|
| `chat` | 大多数兼容 Chat Completions 的模型 | `openai/gpt-5-mini`、`google-ai-studio/gemini-2.5-flash` |
| `responses` | 只支持 OpenAI Responses API 的模型，例如 `gpt-5.6-luna` | `gpt-5.6-luna`，不加供应商前缀 |
| `messages` | Anthropic 原生 Messages API | Anthropic 的裸模型 ID，例如 `claude-haiku-4-5` |

如果不配置 AI Gateway：

- `AI_GATEWAY_ID` 留空；
- `AI_MODEL` 可以留空；
- `AI_API_STYLE` 保持默认的 `chat`；
- 项目会使用 Workers AI 默认模型 `@cf/meta/llama-3.1-8b-instruct-fast`。

### 其他可选变量

| 变量名 | 类型 | 默认值 | 作用 |
|---|---|---|---|
| `AI_GATEWAY_ACCOUNT_ID` | Text | 自动识别 | AI Gateway 所属的 Cloudflare 账号 ID；通常不需要填写 |
| `AI_PROVIDER_KEY` | Secret | 空 | 直接提供 OpenAI、Anthropic 等供应商的 key；使用 Gateway Unified Billing/BYOK 时通常不需要 |
| `AI_GATEWAY_TOKEN` | Secret | 使用 `CF_API_TOKEN` | 单独给 AI Gateway 使用的 Cloudflare token；一般直接复用 `CF_API_TOKEN` 即可 |
| `CF_ACCOUNT_ID` | Text 或 Secret | 自动识别 | Cloudflare 账号 ID；通常不需要填写 |
| `WORKERS_AI_MODEL` | Text | `@cf/meta/llama-3.1-8b-instruct-fast` | 不使用 Gateway 时，Workers AI 压缩所用的模型 |
| `COMPRESS_THRESHOLD` | Text | `8000` | 页面超过约 8000 token 后自动压缩 |
| `COMPRESS_QUERY_MIN` | Text | `800` | 页面超过约 800 token 且传了问题时，触发定向提取 |
| `MCP_TOOLSET` | Text | `full` | `full` 显示全部工具；`minimal` 只显示核心网页读取工具 |

第一次部署建议只填 `API_KEYS` 和 `CF_API_TOKEN`，先把基础功能跑通，再配置 AI Gateway。

## 检查部署是否成功

在浏览器打开：

```text
https://你的-worker.workers.dev/health
```

`/health` 不需要密钥，会告诉你：

- Worker 是否正常；
- 哪些功能已经开启；
- R2 持久缓存是否开启；
- AI 压缩使用哪个模型；
- 哪些配置还缺少。

## 接入 Claude Code、Cursor 等 MCP 客户端

把下面配置里的地址和 key 换成你自己的：

```json
{
  "mcpServers": {
    "web-fetch": {
      "type": "http",
      "url": "https://你的-worker.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer 你的_API_KEYS"
      }
    }
  }
}
```

注意：

- 地址结尾必须是 `/mcp`；
- `Bearer` 后面要有一个空格；
- 这里用的是 `API_KEYS`，不是 `CF_API_TOKEN`，也不是 AI 供应商 key。

不支持 MCP 的客户端也可以直接调用 HTTP 接口：

```bash
curl -X POST https://你的-worker.workers.dev/fetch \
  -H "Authorization: Bearer 你的_API_KEYS" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","query":"这个页面讲了什么？"}'
```

## 能做什么

| 工具 | 作用 | 额外要求 |
|---|---|---|
| `web_fetch` | 读取网页并转成 Markdown | 不需要 |
| `web_screenshot` | 网页截图 | Browser 绑定或 `CF_API_TOKEN` |
| `web_pdf` | 网页转 PDF | Browser 绑定或 `CF_API_TOKEN` |
| `web_extract` | 按要求提取结构化 JSON | `CF_API_TOKEN` |
| `web_links` | 提取页面链接 | `CF_API_TOKEN` |
| `web_scrape` | 按 CSS 选择器抓取页面区域 | `CF_API_TOKEN` |
| `web_a11y` | 获取页面无障碍树 | `CF_API_TOKEN` |
| `web_crawl` | 抓取多个页面 | `CF_API_TOKEN` |
| `web_click`、`web_type` 等 | 点击、输入、执行页面交互 | Browser 绑定 |

没有满足条件的工具不会出现在 MCP 的工具列表里，这是正常现象。

## 常见问题

### 为什么普通网页能读，截图却不能用？

普通读取走的是快速 HTTP 路径，不需要额外凭据。截图、PDF、爬虫和结构化抽取属于高级功能，需要 Browser 绑定或 Cloudflare API token。

### 不开通 R2 能用吗？

可以。默认部署不再声明 R2 binding，也不会要求开通 R2 订阅或绑定付款方式。核心网页读取不依赖 R2；截图、PDF 和 crawl 在其他能力已配置时也能运行，但不会把二进制结果或已完成 crawl 持久缓存。`/health` 中的 `r2_storage: false` 表示这种正常的无 R2 模式。

### `/health` 显示 API_KEYS 未配置怎么办？

检查变量名是否准确写成 `API_KEYS`，类型是否为 Secret，保存后等待 Cloudflare 完成重新部署，再刷新 `/health`。

### AI Gateway 配置后压缩失效怎么办？

检查这四项：

```text
AI_GATEWAY_ID
AI_MODEL
AI_API_STYLE
CF_API_TOKEN
```

尤其是 `gpt-5.6-luna` 必须使用：

```text
AI_API_STYLE=responses
AI_MODEL=gpt-5.6-luna
```

### MCP 里少了几个工具怎么办？

检查 `MCP_TOOLSET` 是否被设置成了 `minimal`。改成 `full` 并保存即可。

### 请求返回 429 怎么办？

这是限流，不一定是部署失败。默认每把 API key 每分钟最多 60 次请求，等一分钟后再试。

## 安全提醒

- `API_KEYS`、`CF_API_TOKEN`、`AI_PROVIDER_KEY`、`AI_GATEWAY_TOKEN` 都是密码，不要提交到 GitHub 或贴到公开聊天中。
- 优先使用 `Authorization` 请求头，不要把 key 放进网址参数。
- 如果 key 泄露，立即在对应平台撤销并重新生成。

## 本地开发（可选）

如果你确实想在本地改代码，才需要 Node.js 18+：

```bash
npm install
npm run dev
npm test
npm run type-check
```

本地密钥放在 `.dev.vars`，不要提交：

```text
API_KEYS=local-dev-key
CF_API_TOKEN=你的-cloudflare-token
```

## 许可

MIT License。