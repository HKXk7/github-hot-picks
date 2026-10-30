/**
 * 应急推送：本机 git 直连 github.com 被重置（Recv failure / Connection reset）时，
 * 改走 GitHub REST API 把本地领先的 commit 逐个重建到远端。
 *
 * 用法：
 *   GH_TOKEN=xxx node scripts/push-via-api.mjs
 *
 * 为什么要这么绕：网络只放通了 api.github.com，git 的 https 传输和 curl 直连都超时。
 * 而 GitHub 的对象模型本来就能用 REST 拼出来——
 *   blob(文件内容) → tree(目录快照) → commit → 移动 ref，
 * 四步等价于一次 push，而且能保住每个 commit 独立（不像 squash 成一坨）。
 *
 * 注意：只处理「改动/新增/删除文件」，不处理 submodule、文件模式变更和空 commit。
 */
import { execFileSync } from "node:child_process";

const OWNER = "HKXk7";
const REPO = "github-hot-picks";
const BRANCH = "main";

const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) {
  console.error("缺少 GH_TOKEN");
  process.exit(1);
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 }).trim();
}

async function gh(pathname, init = {}) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "github-hot-picks",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub API ${init.method ?? "GET"} ${pathname} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

/** 取某次提交里某个文件的完整内容；文件不存在（说明是被删了）返回 null */
function showFile(sha, path) {
  try {
    return execFileSync("git", ["show", `${sha}:${path}`], {
      encoding: "buffer",
      maxBuffer: 1024 * 1024 * 64,
    });
  } catch {
    return null;
  }
}

/** 这个 SHA 在本地仓库里存在吗？远端重写过的 commit 本地是没有的 */
function isLocalCommit(sha) {
  try {
    git("rev-parse", "--verify", `${sha}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

(async () => {
  const realRemote = await gh(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  const remoteSha = realRemote.object.sha;

  // 起点有两种给法：
  //   1. GH_BASE=<本地 sha>：最常见。git fetch 走不通时用它告诉脚本「推它之后的那些 commit」。
  //   2. GH_BASE=<远端 sha> + GH_LOCAL_BASE=<本地 sha>：远端历史被人重写过（commit 被重新
  //      创建、SHA 变了），此时远端起点在本地不存在，两边要分开说。本地起点只用来枚举待推送的
  //      commit，真正作为 API 里 parents / base_tree 的始终是远端真实的 SHA。
  let localBase = null;
  if (process.env.GH_BASE && isLocalCommit(process.env.GH_BASE)) {
    localBase = process.env.GH_BASE;
    console.log(`基准：本地 ${localBase.slice(0, 8)}（远端 ${remoteSha.slice(0, 8)}）`);
  } else if (process.env.GH_BASE && process.env.GH_LOCAL_BASE && isLocalCommit(process.env.GH_LOCAL_BASE)) {
    localBase = process.env.GH_LOCAL_BASE;
    console.log(
      `基准：远端 ${process.env.GH_BASE.slice(0, 8)}（本地对应 ${localBase.slice(0, 8)}，SHA 已被重写过）`,
    );
  } else if (!process.env.GH_BASE) {
    const localRemote = git("rev-parse", `origin/${BRANCH}`);
    // 本地以为的远端位置和真实远端不一致时拒绝继续，避免基于过期认知覆盖别人的提交
    if (localRemote !== remoteSha) {
      console.error(
        `远端已变化：本地以为 ${localRemote.slice(0, 8)}，实际 ${remoteSha.slice(0, 8)}。\n` +
          `请先 git fetch；若网络不通，用 GH_BASE=<本地已推送到的最后一个 commit> 显式指定起点；\n` +
          `若远端历史被重写过（SHA 变了），再配 GH_LOCAL_BASE=<本地对应的那个 commit>。`,
      );
      process.exit(1);
    }
    localBase = localRemote;
  } else {
    console.error("指定的基准既不是本地存在的 commit，也没有配有效的 GH_LOCAL_BASE。");
    process.exit(1);
  }

  const ahead = git("rev-list", "--reverse", `${localBase}..HEAD`).split("\n").filter(Boolean);

  if (ahead.length === 0) {
    console.log("本地没有领先远端的提交，无需推送");
    return;
  }
  console.log(`待推送 ${ahead.length} 个提交：\n`);

  let parentSha = remoteSha;

  for (const sha of ahead) {
    const message = git("log", "-1", "--format=%B", sha);
    const changed = git("diff", "--name-only", `${sha}^`, sha).split("\n").filter(Boolean);

    const treeEntries = [];
    for (const rel of changed) {
      const buf = showFile(sha, rel);
      if (buf === null) {
        // 新提交里没有这个文件 = 删除。sha 置 null 是 GitHub 约定的删除写法
        treeEntries.push({ path: rel, mode: "100644", type: "blob", sha: null });
        console.log(`  🗑  ${rel}`);
        continue;
      }
      const text = buf.toString("utf8");
      const blob = await gh(`/repos/${OWNER}/${REPO}/git/blobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text, encoding: "utf8" }),
      });
      treeEntries.push({ path: rel, mode: "100644", type: "blob", sha: blob.sha });
    }

    // base_tree = 上一个 commit 的 tree，只叠加本次变更，其余文件自动继承
    const parentCommit = await gh(`/repos/${OWNER}/${REPO}/git/commits/${parentSha}`);
    const newTree = await gh(`/repos/${OWNER}/${REPO}/git/trees`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ base_tree: parentCommit.tree.sha, tree: treeEntries }),
    });
    const newCommit = await gh(`/repos/${OWNER}/${REPO}/git/commits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, tree: newTree.sha, parents: [parentSha] }),
    });
    await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sha: newCommit.sha }),
    });

    parentSha = newCommit.sha;
    console.log(`  ✅ ${newCommit.sha.slice(0, 8)} ${message.split("\n")[0]}（${changed.length} 个文件）`);
  }

  console.log(`\n🎉 已推送到 ${BRANCH}，最新 ${parentSha.slice(0, 8)}`);
  // 让本地 origin/main 跟上，否则下次再跑会误判。
  // API 建的 commit 对象本地并不存在，update-ref 会报 nonexistent object——
  // 这是预期内的，真正同步得靠一次能连通的 git fetch，这里忽略即可。
  try {
    git("update-ref", `refs/remotes/origin/${BRANCH}`, parentSha);
  } catch {
    // 用 GH_BASE / GH_LOCAL_BASE 推送时这是常态，不构成问题——本地 Sha 与实际内容无关，
    // 下次显式给基准即可。别把它当成「推送失败」。
    console.log("（本地 origin/main 指针未更新：属预期，下次推送显式给 GH_BASE 即可）");
  }
})().catch((err) => {
  console.error("失败：", err.message);
  process.exit(1);
});
