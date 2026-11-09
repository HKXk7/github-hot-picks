/**
 * 在终端手动触发一次「云端日更」，并盯到它跑完。
 *
 * 为什么不在本机跑 `npm run update:daily`：本地 prisma/dev.db 是另一条历史
 * （期号、去重名单都和 Actions 缓存里的库不一样），本机跑会生成一个对不上的期号，
 * 还会把 public/data 覆盖成本地版本。要补某一天，应该让「持有正确数据库的那一侧」去跑。
 *
 * 用法：
 *   GH_TOKEN=xxx node scripts/trigger-daily.mjs
 *   GH_TOKEN=xxx node scripts/trigger-daily.mjs --no-wait   # 只触发，不等结果
 *
 * token 需要有 Actions: write（经典 token 勾 `workflow`；细粒度 token 给 Actions 读写）。
 * 等结果时只读公开接口就够了，所以没有 token 也能看别人触发的运行。
 */
const OWNER = "HKXk7";
const REPO = "github-hot-picks";
const WORKFLOW = "daily.yml";
const BRANCH = "main";

const TOKEN = process.env.GH_TOKEN;
const NO_WAIT = process.argv.includes("--no-wait");

if (!TOKEN) {
  console.error("缺少 GH_TOKEN（需要 Actions: write 权限）");
  process.exit(1);
}

async function gh(pathname, init = {}) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "github-hot-picks-trigger",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub API ${init.method ?? "GET"} ${pathname} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

/** 只读接口：查注解不需要任何权限，失败原因就靠它 */
async function publicGh(pathname) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "github-hot-picks-trigger" },
  });
  return res.ok ? res.json() : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 触发之后按创建时间和 head sha 认领「我刚点出来的那一次」 */
async function findRun(sinceMs, headSha) {
  const data = await gh(
    `/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=10`,
  );
  return (data.workflow_runs ?? []).find(
    (r) =>
      new Date(r.created_at).getTime() >= sinceMs - 90_000 &&
      (!headSha || r.head_sha === headSha),
  );
}

async function printOutcome(run) {
  console.log(`\n结果：${run.conclusion ?? run.status}`);
  console.log(`链接：${run.html_url}`);

  const jobs = await publicGh(`/repos/${OWNER}/${REPO}/actions/runs/${run.id}/jobs`);
  for (const job of jobs?.jobs ?? []) {
    for (const step of job.steps ?? []) {
      if (step.conclusion && !["success", "skipped"].includes(step.conclusion)) {
        console.log(`  失败步骤：${step.number}. ${step.name}（${step.conclusion}）`);
      }
    }
    // 失败步骤里没有具体原因，再看注解：脚本会用 ::error:: 把真实异常发到这里
    const checks = await publicGh(`/repos/${OWNER}/${REPO}/commits/${run.head_sha}/check-runs`);
    for (const check of checks?.check_runs ?? []) {
      const annotations = await publicGh(`/repos/${OWNER}/${REPO}/check-runs/${check.id}/annotations`);
      for (const a of annotations ?? []) {
        if (a.annotation_level === "failure" || a.message.startsWith("日更失败")) {
          console.log(`  原因：${a.message}`);
        }
      }
    }
  }
  if (run.conclusion === "success") {
    const latest = await publicGh(`/repos/${OWNER}/${REPO}/contents/public/data/latest.json`);
    if (latest?.content) {
      const snapshot = JSON.parse(Buffer.from(latest.content, "base64").toString("utf8"));
      console.log(`  云端最新一期：${snapshot.dateKey}（第 ${snapshot.issue} 期，${snapshot.picks?.length ?? 0} 个项目）`);
    }
  }
}

(async () => {
  const head = await gh(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  console.log(`触发前远端 HEAD：${head.object.sha.slice(0, 8)}`);

  const triggeredAt = Date.now();
  await gh(`/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ref: BRANCH }),
  });
  console.log("已触发 workflow_dispatch，等待队列分配…");

  let run = null;
  for (let i = 0; i < 20 && !run; i++) {
    await sleep(3000);
    run = await findRun(triggeredAt, head.object.sha);
  }
  if (!run) {
    console.error("触发成功但没找到对应的运行记录，去 Actions 页面看一眼：");
    console.error(`https://github.com/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}`);
    process.exit(1);
  }

  console.log(`运行 #${run.run_number}：${run.html_url}`);
  if (NO_WAIT) return;

  // 一次日更正常 2~4 分钟；给足 30 分钟，超时只是不再等，不代表失败
  let last = "";
  for (let i = 0; i < 180; i++) {
    await sleep(10_000);
    const fresh = await gh(`/repos/${OWNER}/${REPO}/actions/runs/${run.id}`);
    if (fresh.status !== last) {
      console.log(`  ${fresh.status}${fresh.conclusion ? ` / ${fresh.conclusion}` : ""}`);
      last = fresh.status;
    }
    if (fresh.status === "completed") {
      await printOutcome(fresh);
      return;
    }
  }
  console.log(`等了 30 分钟还没结束，去页面看：${run.html_url}`);
})().catch((err) => {
  const msg = err.message ?? String(err);
  console.error("失败：", msg);
  // 本机若开着 GitHub 加速器 / 代理，它会用自签 CA 重签证书；Node 默认只信自带 CA 列表，
  // fetch 就会莫名其妙地失败（fetch failed / UNABLE_TO_VERIFY_LEAF_SIGNATURE）。
  // 用 --use-system-ca 让 Node 信任 Windows 根证书库即可，和 scripts/push-via-api.ps1 同一套路。
  if (/fetch failed|UNABLE_TO_VERIFY|certificate|ECONNRESET|network/i.test(msg)) {
    console.error("\n看起来是网络/TLS 问题（常见于开了 GitHub 加速器或代理）。改用系统证书重试：");
    console.error("  node --use-system-ca scripts\\trigger-daily.mjs");
  }
  process.exit(1);
});