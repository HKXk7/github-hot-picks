/**
 * 一键追平云端：把 GitHub 仓库里的静态数据包拉下来，再逐期灌进本地数据库。
 *
 * 用法：
 *   npm run sync:cloud                    # 拉取 public/data + feed.xml，然后把每一期导入本地库
 *   npm run sync:cloud -- --pull-only     # 只拉文件，不动数据库
 *   npm run sync:cloud -- --import-only   # 只导本地已有的 issues/*.json
 *
 * 为什么需要它：云端日更只更新仓库里的 public/data，**不会回流到本机**。
 * 本机站点读的是 prisma/dev.db，于是云端已经到 11-09、本地页面还停在 10-29 ——
 * 这类「明明更新了但我这儿没变」十有八九就是两边库不同步。
 *
 * 取文件优先走 raw.githubusercontent.com（CDN，不计 API 限流）；
 * 只有它被墙/被代理拦了才回退到 contents 接口（未鉴权 60 次/小时，很容易打满，
 * 配 GITHUB_TOKEN / GH_TOKEN 可提到 5000 次/小时）。
 */
import "dotenv/config";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "../generated/prisma/client";
import { importSnapshot, type SnapshotLike } from "../src/lib/pipeline/import-snapshot";

const OWNER = process.env.GH_OWNER ?? "HKXk7";
const REPO = process.env.GH_REPO ?? "github-hot-picks";
const BRANCH = process.env.GH_BRANCH ?? "main";
const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "public", "data");
const ISSUES_DIR = path.join(DATA_DIR, "issues");
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";

const args = new Set(process.argv.slice(2));
const PULL_ONLY = args.has("--pull-only");
const IMPORT_ONLY = args.has("--import-only");

function headers(): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "github-hot-picks-sync",
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  };
}

async function api<T>(pathname: string): Promise<T> {
  const res = await fetch(`https://api.github.com${pathname}`, { headers: headers() });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    const hint =
      res.status === 403 && /rate limit/i.test(body)
        ? "（未鉴权 60 次/小时已打满，配 GITHUB_TOKEN 可提额）"
        : "";
    throw new Error(`GitHub API ${pathname} → ${res.status}${hint}: ${body}`);
  }
  return (await res.json()) as T;
}

/** 读仓库里一个文本文件：先 raw（不吃限流），失败再回退 contents API */
async function getText(remotePath: string): Promise<string> {
  try {
    const raw = await fetch(`https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${remotePath}`, {
      headers: { "User-Agent": "github-hot-picks-sync" },
    });
    if (raw.ok) return raw.text();
  } catch {
    // raw.githubusercontent.com 被代理/加速器拦住时是直接抛异常（fetch failed），
    // 这里不能让它冒到最外层，否则本该走 API 兜底的分支永远走不到。
  }

  // raw 不通（常见于代理/加速器拦截）时才走 API，省限流额度
  const file = await api<{ content: string }>(`/repos/${OWNER}/${REPO}/contents/${remotePath}?ref=${BRANCH}`);
  return Buffer.from(file.content, "base64").toString("utf8");
}

function write(relativePath: string, text: string): void {
  const localPath = path.join(ROOT, relativePath);
  mkdirSync(path.dirname(localPath), { recursive: true });
  writeFileSync(localPath, text, "utf8");
}

interface HistoryEntry {
  dateKey: string;
  issue: number;
}

async function pull() {
  console.log(`⬇️  从 ${OWNER}/${REPO}@${BRANCH} 拉取静态数据包…`);

  // 先拿 history.json：它的 dateKey 列表就是 issues/ 的清单，不用额外列目录（省一次 API）
  const historyText = await getText("public/data/history.json");
  const history = JSON.parse(historyText) as HistoryEntry[];
  write("public/data/history.json", historyText);
  console.log(`   ✓ public/data/history.json（${history.length} 期）`);

  const latestText = await getText("public/data/latest.json");
  const latest = JSON.parse(latestText) as SnapshotLike;
  write("public/data/latest.json", latestText);
  console.log(`   ✓ public/data/latest.json（${latest.dateKey ?? ""} 第 ${latest.issue} 期）`);

  let missing = 0;
  for (const entry of history) {
    try {
      write(`public/data/issues/${entry.dateKey}.json`, await getText(`public/data/issues/${entry.dateKey}.json`));
    } catch (err) {
      missing++;
      console.warn(`   ⚠️ issues/${entry.dateKey}.json 拉不到：${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`   ✓ public/data/issues/（${history.length - missing}/${history.length} 期）`);

  write("public/feed.xml", await getText("public/feed.xml"));
  console.log("   ✓ public/feed.xml");
}

async function importAll() {
  const files = readdirSync(ISSUES_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort(); // 文件名就是日期，升序 = 从旧到新
  if (!files.length) {
    console.log("⚠️ public/data/issues/ 里没有可导入的期，先跑一次拉取");
    return;
  }

  const prisma = new PrismaClient();
  const failed: string[] = [];
  try {
    console.log(`\n📥 导入 ${files.length} 期到本地数据库…`);
    for (const f of files) {
      const snap = JSON.parse(readFileSync(path.join(ISSUES_DIR, f), "utf8")) as SnapshotLike;
      try {
        const r = await importSnapshot(prisma, snap);
        const warn = r.missing.length ? `，${r.missing.length} 个缺库记录` : "";
        console.log(`   ✓ ${f} → 第 ${r.issue} 期（${r.picks} 个${warn}）`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failed.push(`${f}: ${msg}`);
        console.error(`   ✗ ${f} → ${msg}`);
      }
    }

    const latest = await prisma.article.findFirst({ orderBy: { issue: "desc" } });
    console.log(
      `\n✅ 本地库最新：第 ${latest?.issue ?? "?"} 期「${latest?.title ?? "—"}」（${files.length - failed.length}/${files.length} 期导入成功）`,
    );
    if (failed.length) {
      console.error(`⚠️ 有 ${failed.length} 期失败：\n${failed.join("\n")}`);
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  if (!TOKEN && !IMPORT_ONLY) {
    console.log(
      "提示：没配 GITHUB_TOKEN，走的是未鉴权的 60 次/小时额度（一次同步约 15 次请求）。\n" +
        '      配额打满就等一小时，或先设 $env:GH_TOKEN="..." 再跑。\n',
    );
  }
  if (!IMPORT_ONLY) await pull();
  if (!PULL_ONLY) await importAll();
  if (PULL_ONLY) console.log("\n（--pull-only：只拉文件，没有动数据库）");
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("失败：", msg);
  if (/fetch failed|UNABLE_TO_VERIFY|certificate|ECONNRESET|network/i.test(msg)) {
    console.error("\n看起来是网络/TLS 问题（本机若开着 GitHub 加速器或代理，会用自签 CA 重签证书）。改用系统证书重试：");
    console.error("  node --use-system-ca node_modules/tsx/dist/cli.mjs scripts/sync-cloud.ts");
  }
  process.exit(1);
});