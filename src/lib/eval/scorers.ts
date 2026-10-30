import { lookupPackage, type Ecosystem, type LookupResult } from "../ai/tools/package";
import type { CommandCheck, CommandVerdict } from "./types";

/**
 * 命令真实性验证 —— 整套 eval 里最有价值的那个评分器。
 *
 * 背景：模型写安装命令时最常见的错误不是语法错，而是**包名是它照着仓库名猜的**。
 * 这类错误肉眼很难发现（`npm install vue-use` 和 `npm install @vueuse/core` 都像是真的），
 * 但对着 registry 查一下就露馅了。于是「教程质量」这种主观问题，
 * 有一块可以变成「查得到 / 查不到」的客观判定。
 */

/** 一条命令里可能混着多步：git clone && cd x && npm install —— 得分开判 */
export function splitSteps(command: string): string[] {
  return command
    .split(/&&|;/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 需要跳过的命令行开关 */
const FLAGS = new Set([
  "-g",
  "--global",
  "-D",
  "-S",
  "--save",
  "--save-dev",
  "--save-exact",
  "-E",
  "-y",
  "--yes",
  "-f",
  "--force",
  "--location=global",
  "-w",
]);

// 注意：这里刻意不含 create / init，那些走下面的 CREATE_TRIGGERS
const NPM_TRIGGERS = [
  "npm install",
  "npm i ",
  "npm add",
  "npx ",
  "pnpm add",
  "pnpm i ",
  "pnpm install",
  "pnpx ",
  "yarn add",
  "yarn global add",
  "bun add",
  "bunx ",
];

const PYPI_TRIGGERS = ["pip install", "pip3 install", "python -m pip install", "uv pip install", "pipx install"];

const CRATES_TRIGGERS = ["cargo install", "cargo add"];

/**
 * `npm create xxx` 这类脚手架命令的包名是 `create-xxx`，不是 `xxx`。
 * 第一次跑评测时就在这里栽了：模型写的 `npm create tauri-app@latest` 是对的，
 * 却被判成编造。评分器出现假阳性比漏判更糟——它会把「模型变笨了」
 * 变成一个假结论，进而误导后面所有调优。
 */
const CREATE_TRIGGERS = ["npm create", "pnpm create", "yarn create", "bun create", "npm init", "pnpm init"];

interface ParsedPackage {
  ecosystem: Ecosystem;
  name: string;
}

/**
 * 剥掉版本限定符：`lodash@^4.0.0` → `lodash`，`requests==2.31` → `requests`。
 *
 * 坑在这里：npm 的 scoped 包本身以 @ 开头（`@vueuse/core`），
 * 直接按 @ 截断会被削成空字符串，导致 scoped 包全部漏判 —— 而 scoped 包恰恰最常见。
 * 所以先按 scoped 语法整体匹配，再处理剩余情况。
 */
function stripVersion(token: string): string {
  const scoped = token.match(/^(@[^/@]+(?:\/[^@]+)?)(?:@[\w.+-]+)?$/);
  if (scoped) return scoped[1];
  return token.replace(/[@><=~^]+\S*$/, "").replace(/\[[^\]]*\]$/, "").trim();
}

/**
 * 判断一个 token 像不像包名。
 * 分两种形态：普通包 `lodash`，以及 npm scoped 包 `@vueuse/core`。
 * 注意 scoped 包以 @ 开头，用「必须字母数字开头」的正则会把它整类漏掉。
 */
function isPlausiblePackageName(name: string): boolean {
  if (!name) return false;
  if (/^@[^/@]+\/[^@/]+$/.test(name)) return true;
  return /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(name);
}

function firstPackageToken(rest: string): string | null {
  const tokens = rest.split(/\s+/).filter(Boolean);
  for (const raw of tokens) {
    if (raw.startsWith("-")) continue; // 形如 --registry 的长开关也一并跳过
    // 本地路径、URL、磁盘前缀都不是包名
    if (/^[./~]|^https?:\/\//.test(raw)) continue;
    if (FLAGS.has(raw)) continue;
    const name = stripVersion(raw);
    if (isPlausiblePackageName(name)) return name;
  }
  return null;
}

/** 从一条子命令里认出「包管理器 + 包名」；认不出返回 null（即不可查证） */
export function parseInstallCommand(cmd: string): ParsedPackage | null {
  const lower = cmd.toLowerCase();

  const hit = (list: string[], eco: Ecosystem): ParsedPackage | null => {
    const trigger = list.find((t) => lower.startsWith(t) || lower.includes(` ${t.trim()}`));
    if (!trigger) return null;
    const idx = lower.indexOf(trigger);
    const rest = cmd.slice(idx + trigger.length);
    const name = firstPackageToken(rest);
    // npx 允许只跟一个可执行包名，其余情况必须有包名才算
    return name ? { ecosystem: eco, name } : null;
  };

  const npm = hit(NPM_TRIGGERS, "npm");
  if (npm) return npm;
  const pypi = hit(PYPI_TRIGGERS, "pypi");
  if (pypi) return pypi;
  const crates = hit(CRATES_TRIGGERS, "crates");
  if (crates) return crates;

  const created = hit(CREATE_TRIGGERS, "npm");
  return created ? { ecosystem: "npm", name: `create-${created.name}` } : null;
}

/** 从 git clone 里抽出 owner/repo；不是 GitHub 地址返回 null */
export function parseGithubRepo(cmd: string): string | null {
  const m = cmd.match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(\.git|\s|$)/);
  return m ? m[1] : null;
}

async function checkGithubRepo(repo: string): Promise<CommandCheck["verdict"]> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: {
        "User-Agent": "github-hot-picks",
        ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return "verified";
    if (res.status === 404) return "fabricated";
    return "error";
  } catch {
    return "error";
  }
}

function detailFor(result: LookupResult, name: string, ecosystem: Ecosystem): string {
  if (result.status === "found") return `${ecosystem}:${result.facts.name}@${result.facts.version} 存在`;
  if (result.status === "missing") return `${ecosystem}:${name} 查无此包`;
  return `查询失败：${result.message}`;
}

/** 验证单条命令（内部会先拆成子命令） */
export async function checkCommand(command: string): Promise<CommandCheck[]> {
  const steps = splitSteps(command);
  const out: CommandCheck[] = [];

  for (const step of steps) {
    const parsed = parseInstallCommand(step);
    if (parsed) {
      const result = await lookupPackage(parsed.ecosystem, parsed.name);
      const verdict: CommandVerdict =
        result.status === "found" ? "verified" : result.status === "missing" ? "fabricated" : "error";
      out.push({
        command: step,
        verdict,
        ecosystem: parsed.ecosystem,
        packageName: parsed.name,
        detail: detailFor(result, parsed.name, parsed.ecosystem),
      });
      continue;
    }

    const repo = parseGithubRepo(step);
    if (repo) {
      const verdict = await checkGithubRepo(repo);
      out.push({
        command: step,
        verdict,
        detail: verdict === "verified" ? `${repo} 仓库存在` : verdict === "fabricated" ? `${repo} 仓库不存在` : "GitHub 查询失败",
      });
      continue;
    }

    // git/docker/curl/make/apt/brew/go 等：不是我能查证的东西，如实标记
    out.push({ command: step, verdict: "unverifiable", detail: "无法自动查证（非包管理器命令）" });
  }

  return out;
}

/**
 * 命令里出现的版本号或保险声明会触发 /[@><=~^]+\S*$/ 判断，这里是给外部复用的别名，
 * 便于在测试里直接验证解析逻辑。
 */
export { stripVersion };
