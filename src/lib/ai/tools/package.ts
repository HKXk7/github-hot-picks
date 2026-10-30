import type { Tool } from "./types";
import { str, truncate } from "./types";

/**
 * 包管理器查询。
 *
 * 这是整套工具里最能直接降低幻觉的一个：模型写「npm install xxx」时往往是照着项目名猜的，
 * 而包在 registry 里到底叫不叫这个名字、有没有这个包，一查就知道。
 * 三个 registry 都是免鉴权的公开接口，不需要任何 key。
 *
 * 这里刻意把「查询」和「格式化成给模型看的文本」拆开：
 * 查询部分（lookupPackage）返回结构化结果，评测层要用它来验证教程里的命令是不是编的，
 * 不能只有一段给人读的字符串。
 */
export type Ecosystem = "npm" | "pypi" | "crates";

export const ECOSYSTEMS: Ecosystem[] = ["npm", "pypi", "crates"];

export interface PackageFacts {
  ecosystem: Ecosystem;
  /** registry 里记录的真实包名（大小写可能与查询的不同） */
  name: string;
  version: string;
  description?: string;
  repository?: string;
  homepage?: string;
  /** 提供的可执行命令名 */
  bin?: string[];
}

/**
 * 三态结果很关键：评测时如果把「网络抖动」当成「包不存在」，
 * 会把正确的命令误判成编造的，指标就不可信了。
 */
export type LookupResult =
  | { status: "found"; facts: PackageFacts }
  | { status: "missing" }
  | { status: "error"; message: string };

interface FetchOutcome {
  status: number;
  data: unknown | null;
  error?: boolean;
}

async function getJson(url: string, timeoutMs = 12_000): Promise<FetchOutcome> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "github-hot-picks", Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { status: res.status, data: null };
    try {
      return { status: res.status, data: (await res.json()) as unknown };
    } catch {
      return { status: res.status, data: null, error: true };
    }
  } catch {
    // 超时 / DNS / 连接重置都走这里，与业务上的 404 区分开
    return { status: 0, data: null, error: true };
  }
}

/** npm 包名里的 @scope/ 前缀不能被整体 encode，否则 %2F 会让 registry 认不出来 */
function npmPath(name: string): string {
  return name
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

export async function lookupPackage(ecosystem: Ecosystem, name: string): Promise<LookupResult> {
  const clean = name.trim();
  if (!clean) return { status: "missing" };

  if (ecosystem === "npm") {
    // /latest 比整包列表小两个数量级，够用了
    const { status, data, error } = await getJson(`https://registry.npmjs.org/${npmPath(clean)}/latest`);
    if (error) return { status: "error", message: `registry.npmjs.org 请求失败（HTTP ${status}）` };
    if (status === 404 || !data) return { status: "missing" };
    const r = data as {
      name?: string;
      version?: string;
      description?: string;
      homepage?: string;
      repository?: { url?: string } | string;
      bin?: Record<string, string>;
    };
    if (!r.version) return { status: "missing" };
    const repoUrl = typeof r.repository === "string" ? r.repository : r.repository?.url;
    return {
      status: "found",
      facts: {
        ecosystem,
        name: r.name ?? clean,
        version: r.version,
        description: r.description,
        homepage: r.homepage,
        repository: repoUrl,
        bin: r.bin ? Object.keys(r.bin) : undefined,
      },
    };
  }

  if (ecosystem === "pypi") {
    const { status, data, error } = await getJson(`https://pypi.org/pypi/${encodeURIComponent(clean)}/json`);
    if (error) return { status: "error", message: `pypi.org 请求失败（HTTP ${status}）` };
    if (status === 404 || !data) return { status: "missing" };
    const info = (data as { info?: Record<string, unknown> }).info as
      | { name?: string; version?: string; summary?: string; home_page?: string; project_urls?: Record<string, string> }
      | undefined;
    if (!info?.version) return { status: "missing" };
    return {
      status: "found",
      facts: {
        ecosystem,
        name: info.name ?? clean,
        version: info.version,
        description: info.summary,
        homepage: info.home_page,
        repository: info.project_urls?.Source,
      },
    };
  }

  const { status, data, error } = await getJson(`https://crates.io/api/v1/crates/${encodeURIComponent(clean)}`);
  if (error) return { status: "error", message: `crates.io 请求失败（HTTP ${status}）` };
  if (status === 404 || !data) return { status: "missing" };
  const c = (data as { crate?: Record<string, unknown> }).crate as
    | { name?: string; max_version?: string; description?: string; homepage?: string; repository?: string }
    | undefined;
  if (!c?.max_version) return { status: "missing" };
  return {
    status: "found",
    facts: {
      ecosystem,
      name: c.name ?? clean,
      version: c.max_version,
      description: c.description,
      homepage: c.homepage,
      repository: c.repository,
    },
  };
}

// ================= 给模型看的文本 =================
const ECOSYSTEM_LABEL: Record<Ecosystem, string> = {
  npm: "npm",
  pypi: "PyPI",
  crates: "crates.io",
};

const INSTALL_CMD: Record<Ecosystem, (name: string) => string> = {
  npm: (n) => `npm install ${n}`,
  pypi: (n) => `pip install ${n}`,
  crates: (n) => `cargo install ${n}`,
};

function renderNotFound(ecosystem: Ecosystem, name: string): string {
  return `${ECOSYSTEM_LABEL[ecosystem]} 上查不到包「${name}」（可能名字不对，或它根本没发布到这里）。`;
}

function renderFacts(facts: PackageFacts, queriedName: string): string {
  return [
    `✅ ${ECOSYSTEM_LABEL[facts.ecosystem]} 包存在：${facts.name}`,
    `最新版本：${facts.version}`,
    facts.description ? `描述：${facts.description}` : null,
    facts.repository ? `仓库：${facts.repository}` : null,
    facts.homepage ? `主页：${facts.homepage}` : null,
    facts.bin?.length ? `提供命令行：${facts.bin.join("、")}（可用 npx 运行）` : null,
    `安装命令：${INSTALL_CMD[facts.ecosystem](queriedName)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export const packageInfoTool: Tool = {
  spec: {
    type: "function",
    function: {
      name: "fetch_package_info",
      description:
        "查询某个包在 npm / PyPI / crates.io 上是否真实存在，并返回最新版本、描述、仓库地址和正确的安装命令。当你准备在教程里写出安装命令时，必须先用这个工具核实包名，禁止凭项目名猜测包名。优先按项目主语言选对应生态（JS/TS→npm、Python→pypi、Rust→crates）；若查到的包描述或仓库地址与该项目对不上，说明是同名不同项目，此时再查其他生态交叉验证，并在结论里明确区分。",
      parameters: {
        type: "object",
        properties: {
          ecosystem: { type: "string", enum: ECOSYSTEMS, description: "包管理器：npm / pypi / crates" },
          name: { type: "string", description: "包名，例如 react、requests、ripgrep" },
        },
        required: ["ecosystem", "name"],
      },
    },
  },
  async execute(args) {
    const ecosystem = str(args.ecosystem) as Ecosystem;
    const name = str(args.name);
    if (!name) return "参数错误：缺少 name。";
    if (!ECOSYSTEMS.includes(ecosystem)) {
      return `参数错误：ecosystem 必须是 ${ECOSYSTEMS.join(" / ")} 之一。`;
    }
    const result = await lookupPackage(ecosystem, name);
    if (result.status === "missing") return renderNotFound(ecosystem, name);
    if (result.status === "error") return `查询失败：${result.message}`;
    return truncate(renderFacts(result.facts, name), 1500);
  },
};
