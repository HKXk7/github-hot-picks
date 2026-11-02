import { describe, expect, it } from "vitest";
import { parseGithubRepo, parseInstallCommand, splitSteps } from "./scorers";

/**
 * 这套测试是在两个假阳性 bug 之后补的。
 * 评分器出错的代价远大于漏判：它会得出「模型变笨了」的假结论，
 * 之后所有基于它的调优决策都被带偏。
 */
describe("parseInstallCommand", () => {
  it("识别 npm scoped 包", () => {
    // 曾经被版本正则削成空字符串，整类 scoped 包漏判
    expect(parseInstallCommand("npm install @vueuse/core")).toEqual({
      ecosystem: "npm",
      name: "@vueuse/core",
    });
  });

  it("剥掉 npm 版本限定符", () => {
    expect(parseInstallCommand("npm i lodash@^4.0.0")?.name).toBe("lodash");
  });

  it("脚手架命令的包名带 create- 前缀", () => {
    // `npm create tauri-app@latest` 是对的，曾经被判成编造
    expect(parseInstallCommand("npm create tauri-app@latest")).toEqual({
      ecosystem: "npm",
      name: "create-tauri-app",
    });
    expect(parseInstallCommand("pnpm create vite@latest")?.name).toBe("create-vite");
  });

  it("识别 pip 与版本钉死写法", () => {
    expect(parseInstallCommand("pip install requests==2.31.0")).toEqual({
      ecosystem: "pypi",
      name: "requests",
    });
    expect(parseInstallCommand("uv pip install ruff")?.ecosystem).toBe("pypi");
  });

  it("识别 cargo", () => {
    expect(parseInstallCommand("cargo install ripgrep")).toEqual({
      ecosystem: "crates",
      name: "ripgrep",
    });
  });

  it("跳过命令行开关", () => {
    expect(parseInstallCommand("npx -y some-cli")?.name).toBe("some-cli");
    expect(parseInstallCommand("npm install --save-dev vitest")?.name).toBe("vitest");
  });

  it("认不出的命令返回 null，交给「不可查证」而不是算作编造", () => {
    expect(parseInstallCommand("git clone https://github.com/foo/bar")).toBeNull();
    expect(parseInstallCommand("make build")).toBeNull();
    expect(parseInstallCommand("docker compose up")).toBeNull();
  });

  it("只有包管理器没有包名时不硬凑", () => {
    expect(parseInstallCommand("npm install")).toBeNull();
  });

  it("本地路径不当作包名", () => {
    expect(parseInstallCommand("npm install ./packages/core")).toBeNull();
  });
});

describe("splitSteps", () => {
  it("拆开用 && 串联的多步命令", () => {
    expect(splitSteps("git clone https://github.com/a/b && cd b && npm install")).toEqual([
      "git clone https://github.com/a/b",
      "cd b",
      "npm install",
    ]);
  });

  it("也支持分号", () => {
    expect(splitSteps("cd b; npm install")).toEqual(["cd b", "npm install"]);
  });
});

describe("parseGithubRepo", () => {
  it("从 https 地址里取 owner/repo", () => {
    expect(parseGithubRepo("git clone https://github.com/facebook/react.git")).toBe("facebook/react");
  });

  it("支持 ssh 写法并去掉 .git 后缀", () => {
    expect(parseGithubRepo("git clone git@github.com:facebook/react.git")).toBe("facebook/react");
  });

  it("非 GitHub 地址返回 null", () => {
    expect(parseGithubRepo("git clone https://gitlab.com/foo/bar.git")).toBeNull();
  });
});
