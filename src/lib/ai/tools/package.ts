import type { Tool } from "./types";
import { str, truncate } from "./types";
import { fetchJson } from "./web";

/**
 * 包管理器查询。
 *
 * 这是整套工具里最能直接降低幻觉的一个：模型写「npm install xxx」时往往是照着项目名猜的，
 * 而包在 registry 里到底叫不叫这个名字、有没有这个包，一查就知道。
 * 三个 registry 都是免鉴权的公开接口，不需要任何 key。
 */
type Ecosystem = "npm" | "pypi" | "crates";

const ECOSYSTEMS: Ecosystem[] = ["npm", "pypi", "crates"];

async function queryNpm(name: string): Promise<string> {
  // /latest 比整包列表小两个数量级，够用了
  const r = await fetchJson<{
    name?: string;
    version?: string;
    description?: string;
    homepage?: string;
    repository?: { url?: string } | string;
    license?: string;
    bin?: Record<string, string>;
  }>(`https://registry.npmjs.org/${encodeURIComponent(name).replace("%2F", "/")}/latest`);

  if (!r?.version) return `npm 上查不到包「${name}」（可能名字不对，或它根本不在 npm 发布）。`;
  const repoUrl = typeof r.repository === "string" ? r.repository : r.repository?.url;
  return [
    `✅ npm 包存在：${r.name ?? name}`,
    `最新版本：${r.version}`,
    r.description ? `描述：${r.description}` : null,
    r.license ? `协议：${r.license}` : null,
    repoUrl ? `仓库：${repoUrl}` : null,
    r.homepage ? `主页：${r.homepage}` : null,
    r.bin && Object.keys(r.bin).length
      ? `提供命令行：${Object.keys(r.bin).join("、")}（可用 npx 运行）`
      : null,
    `安装命令：npm install ${name}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function queryPypi(name: string): Promise<string> {
  const r = await fetchJson<{
    info?: {
      name?: string;
      version?: string;
      summary?: string;
      home_page?: string;
      project_urls?: Record<string, string>;
      license?: string;
    };
  }>(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);

  if (!r?.info?.version) return `PyPI 上查不到包「${name}」。`;
  const info = r.info;
  return [
    `✅ PyPI 包存在：${info.name ?? name}`,
    `最新版本：${info.version}`,
    info.summary ? `描述：${info.summary}` : null,
    info.license ? `协议：${info.license}` : null,
    info.project_urls?.Source ? `仓库：${info.project_urls.Source}` : null,
    info.home_page ? `主页：${info.home_page}` : null,
    `安装命令：pip install ${name}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function queryCrates(name: string): Promise<string> {
  const r = await fetchJson<{
    crate?: { name?: string; max_version?: string; description?: string; homepage?: string; repository?: string };
  }>(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`);

  if (!r?.crate?.max_version) return `crates.io 上查不到 crate「${name}」。`;
  const c = r.crate;
  return [
    `✅ crate 存在：${c.name ?? name}`,
    `最新版本：${c.max_version}`,
    c.description ? `描述：${c.description}` : null,
    c.repository ? `仓库：${c.repository}` : null,
    c.homepage ? `主页：${c.homepage}` : null,
    `安装命令：cargo install ${name}`,
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
    try {
      const out =
        ecosystem === "npm"
          ? await queryNpm(name)
          : ecosystem === "pypi"
            ? await queryPypi(name)
            : await queryCrates(name);
      return truncate(out, 1500);
    } catch (err) {
      return `查询失败：${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
