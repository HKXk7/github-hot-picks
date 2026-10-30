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

(async () => {
  const realRemote = await gh(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  const remoteSha = realRemote.object.sha;

  // 起点有两种给法：
  //   1. 默认用本地的 origin/<branch>（前提是它没过期）
  //   2. GH_BASE=<本地 sha>：git fetch 走不通、origin 指针已经落后时手动指定
  //      「本地已经推到哪儿了」，推它之后的那些 commit。
  let ahead;
  if (process.env.GH_BASE) {
    ahead = git("rev-list", "--reverse", `${process.env.GH_BASE}..HEAD`).split("\n").filter(Boolean);
    console.log(`基准：本地 ${process.env.GH_BASE.slice(0, 8)}（远端 ${remoteSha.slice(0, 8)}）`);
  } else {
    const localRemote = git("rev-parse", `origin/${BRANCH}`);
    // 本地以为的远端位置和真实远端不一致时拒绝继续，避免基于过期认知覆盖别人的提交
    if (localRemote !== remoteSha) {
      console.error(
        `远端已变化：本地以为 ${localRemote.slice(0, 8)}，实际 ${remoteSha.slice(0, 8)}。\n` +
          `请先 git fetch；若网络不通，用 GH_BASE=<本地已推送到的最后一个 commit> 显式指定起点。`,
      );
      process.exit(1);
    }
    ahead = git("rev-list", "--reverse", `${localRemote}..HEAD`).split("\n").filter(Boolean);
  }

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
    console.log("（本地 origin/main 指针未能更新，下次推送前请先 git fetch）");
  }
})().catch((err) => {
  console.error("失败：", err.message);
  process.exit(1);
});
