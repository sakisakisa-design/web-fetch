#!/usr/bin/env node
/**
 * One-command setup.
 *
 * Deploys the Worker without R2, provisions KV, generates an API key, and
 * optionally stores one Cloudflare API token. Account ID is detected from
 * that token — you never type it. There is no provider (OpenAI) key.
 *
 *   npm run setup
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const isWindows = process.platform === "win32";

const style = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};

function info(message) {
  console.log(`${style.dim("?")} ${message}`);
}
function ok(message) {
  console.log(`${style.green("?")} ${message}`);
}
function warn(message) {
  console.log(`${style.yellow("!")} ${message}`);
}
function fail(message) {
  console.error(`${style.red("?")} ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    stdio: options.input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
    shell: isWindows,
    encoding: "utf8",
    ...options,
  });
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: isWindows,
    encoding: "utf8",
  });
  return result.status === 0 ? (result.stdout ?? "").trim() : null;
}

function wrangler(args, options) {
  return run("npx", ["--yes", "wrangler@4", ...args], options);
}

function putSecret(name, value) {
  const result = wrangler(["secret", "put", name], { input: value });
  if (result.status !== 0) {
    fail(`Failed to set the ${name} secret.`);
  }
}

/** Write a wrangler.jsonc string var in place. Gateway id / model are not secrets. */
function setWranglerVar(name, value) {
  const path = "wrangler.jsonc";
  const text = readFileSync(path, "utf8");
  const re = new RegExp(`("${name}":\\s*")[^"]*(")`);
  if (!re.test(text)) {
    fail(`wrangler.jsonc has no ${name} field to fill in.`);
  }
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  writeFileSync(path, text.replace(re, `$1${escaped}$2`));
}

function parseWhoamiAccounts(raw) {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    const list = data.accounts ?? [];
    return list
      .map((a) => ({
        id: a.id ?? a.account_id,
        name: a.name ?? a.account_name ?? a.id,
      }))
      .filter((a) => typeof a.id === "string" && a.id);
  } catch {
    return [];
  }
}

async function accountsFromToken(token) {
  try {
    const res = await fetch("https://api.cloudflare.com/client/v4/accounts?per_page=50", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const body = await res.json();
    const list = Array.isArray(body.result) ? body.result : [];
    return list
      .map((a) => ({ id: a.id, name: a.name || a.id }))
      .filter((a) => typeof a.id === "string" && a.id);
  } catch {
    return [];
  }
}

async function pickAccount(rl, accounts, label) {
  if (accounts.length === 0) return null;
  if (accounts.length === 1) {
    const a = accounts[0];
    ok(`Account: ${a.name} (${a.id})`);
    return a.id;
  }

  console.log(style.dim(`\n  This ${label} can see ${accounts.length} accounts:`));
  accounts.forEach((a, i) => {
    console.log(`    ${i + 1}. ${a.name}  ${style.dim(a.id)}`);
  });
  const answer = (await rl.question("  Which one? [1] ")).trim() || "1";
  const index = Number.parseInt(answer, 10) - 1;
  const chosen = accounts[index];
  if (!chosen) {
    warn("Not a valid choice — skipping account ID (the Worker will detect it at runtime).");
    return null;
  }
  ok(`Using ${chosen.name}`);
  return chosen.id;
}

function findWorkerUrl(output) {
  if (!output) return null;
  const match = /https:\/\/[a-z0-9.-]+\.workers\.dev/i.exec(output);
  return match ? match[0] : null;
}

async function main() {
  console.log(style.bold("\nweb-fetch setup\n"));

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 18) {
    fail(`Node 18+ is required (found ${process.versions.node}).`);
  }

  info("Checking your Cloudflare login…");
  const whoamiText = capture("npx", ["--yes", "wrangler@4", "whoami"]);
  if (!whoamiText || /not authenticated|you are not logged in/i.test(whoamiText)) {
    fail("Not logged in to Cloudflare. Run `npx wrangler login` and try again.");
  }
  ok("Cloudflare CLI is authenticated.");

  const whoamiJson = capture("npx", ["--yes", "wrangler@4", "whoami", "--json"]);
  const whoamiAccounts = parseWhoamiAccounts(whoamiJson);

  info("Deploying the Worker without R2 (this also creates KV). Takes about 30s…");
  const deploy = spawnSync("npx", ["--yes", "wrangler@4", "deploy"], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: isWindows,
    encoding: "utf8",
  });
  const deployOutput = `${deploy.stdout ?? ""}${deploy.stderr ?? ""}`;
  console.log(style.dim(deployOutput.trim()));
  if (deploy.status !== 0) {
    fail("Deploy failed. Fix the error above and re-run `npm run setup`.");
  }
  ok("Worker deployed.");

  const apiKey = randomBytes(32).toString("hex");
  info("Generating an API key and storing it as a secret…");
  putSecret("API_KEYS", apiKey);
  ok("API key stored.");

  const rl = createInterface({ input: stdin, output: stdout });

  console.log(
    style.dim(
      "\nThe Worker already works for plain page reads.\n" +
        "One Cloudflare API token unlocks screenshots, crawl, and AI compression.\n" +
        "Account ID is detected automatically — you will not be asked for it.\n",
    ),
  );

  const wantsToken = await rl.question(
    "Paste a Cloudflare API token now? (Enter to skip) ",
  );
  const apiToken = wantsToken.trim();
  if (apiToken) {
    putSecret("CF_API_TOKEN", apiToken);
    ok("Cloudflare API token stored.");

    info("Detecting account ID from the token…");
    let accounts = await accountsFromToken(apiToken);
    if (accounts.length === 0 && whoamiAccounts.length > 0) {
      warn("Token could not list accounts; falling back to your wrangler login.");
      accounts = whoamiAccounts;
    }
    const accountId = await pickAccount(rl, accounts, "token");
    if (accountId) {
      putSecret("CF_ACCOUNT_ID", accountId);
      ok("Account ID stored (detected, not typed).");
    } else {
      warn("Account ID not stored. The Worker will look it up from the token on first use.");
    }
  } else {
    warn("Skipped. You can add it later: npx wrangler secret put CF_API_TOKEN");
  }

  const wantsAi = await rl.question(
    "\nUse AI Gateway for better compression (GPT / Claude / Gemini)? [y/N] ",
  );
  if (/^y/i.test(wantsAi.trim())) {
    console.log(
      style.dim(
        "  Create a gateway at https://dash.cloudflare.com ? AI ? AI Gateway.\n" +
          "  Turn on Unified Billing or store provider keys on the gateway (BYOK).\n" +
          "  Same Cloudflare token as above — no OpenAI/Anthropic key to paste here.\n",
      ),
    );
    const gatewayId = (await rl.question("  AI Gateway name/id: ")).trim();
    const model =
      (await rl.question("  Model [openai/gpt-5-mini]: ")).trim() || "openai/gpt-5-mini";

    if (gatewayId) {
      setWranglerVar("AI_GATEWAY_ID", gatewayId);
      setWranglerVar("AI_MODEL", model);
      ok(`Wrote AI_GATEWAY_ID and AI_MODEL to wrangler.jsonc.`);
      info("Redeploying so the gateway settings take effect…");
      const redeploy = wrangler(["deploy"]);
      if (redeploy.status !== 0) {
        fail("Redeploy failed. Fix the error above and run `npx wrangler deploy`.");
      }
      ok("Redeployed.");
      if (!apiToken) {
        warn("Compression still needs CF_API_TOKEN. Run setup again or: npx wrangler secret put CF_API_TOKEN");
      }
    } else {
      warn("Skipped — no gateway id.");
    }
  }

  rl.close();

  const deployedUrl = findWorkerUrl(deployOutput) ?? "https://<your-worker>.workers.dev";

  console.log(style.bold("\n\nDone.\n"));
  console.log("Paste this into your MCP client config:\n");
  console.log(
    JSON.stringify(
      {
        mcpServers: {
          "web-fetch": {
            type: "http",
            url: `${deployedUrl}/mcp`,
            headers: { Authorization: `Bearer ${apiKey}` },
          },
        },
      },
      null,
      2,
    ),
  );
  console.log(`\nCheck what this deployment can do:\n  curl ${deployedUrl}/health\n`);
  console.log(
    style.yellow("Save the API key now — it is stored as a secret and cannot be read back:"),
  );
  console.log(`  ${apiKey}\n`);
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
