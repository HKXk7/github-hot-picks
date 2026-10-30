/**
 * dsh-bridge.ts —— DSH 插件的 JSON 命令行桥
 * ============================================
 * 所有输出只走 stdout（一行 JSON），日志/诊断走 stderr。
 * 子命令：status  picks  history  runs  run
 *
 * 用法（在仓库根目录跑）：
 *   npx tsx scripts/dsh-bridge.ts status
 *   npx tsx scripts/dsh-bridge.ts picks --limit 10
 *   npx tsx scripts/dsh-bridge.ts history              # list 所有去重名
 *   npx tsx scripts/dsh-bridge.ts history --remove x/y
 *   npx tsx scripts/dsh-bridge.ts history --clear
 *   npx tsx scripts/dsh-bridge.ts runs --limit 5
 *   npx tsx scripts/dsh-bridge.ts run                  # 跑一天一更
 */
import "dotenv/config"
import { spawn } from "node:child_process"
import { join } from "node:path"
import { PrismaClient } from "../generated/prisma/client"

const prisma = new PrismaClient()

// =========== 工具函数 ===========

function dayKey(d: Date | string = new Date()): string {
  return new Date(d).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })
}

function out(obj: unknown) {
  process.stdout.write(JSON.stringify(obj) + "\n")
}

function die(msg: string) {
  process.stderr.write(msg + "\n")
  process.exit(1)
}

// =========== 子命令 ===========

async function cmdStatus() {
  const [article, run] = await Promise.all([
    prisma.article.findFirst({
      where: { status: "published" },
      orderBy: { weekStart: "desc" },
      include: {
        recommendations: {
          orderBy: { sortOrder: "asc" },
          include: { repository: true },
        },
      },
    }),
    prisma.jobRun.findFirst({
      where: { jobType: "daily-update" },
      orderBy: { startedAt: "desc" },
    }),
  ])

  if (!article || article.recommendations.length === 0) {
    return out({ ok: true, issue: 0, dateKey: dayKey(), picks: 0, withTutorial: 0, totalStars: 0, lastRun: null, hint: "还没有生成过推荐数据" })
  }

  const recs = article.recommendations
  const withTutorial = recs.filter((r) => r.repository.tutorial).length
  const totalStars = recs.reduce((s, r) => s + r.repository.stars, 0)

  out({
    ok: true,
    issue: article.issue,
    dateKey: dayKey(article.weekStart),
    title: article.title,
    picks: recs.length,
    withTutorial,
    totalStars,
    lastRun: run
      ? {
          jobType: run.jobType,
          status: run.status,
          startedAt: run.startedAt.toISOString(),
          endedAt: run.endedAt?.toISOString() ?? null,
          log: run.log,
        }
      : null,
  })
}

async function cmdPicks(limit = 10) {
  const article = await prisma.article.findFirst({
    where: { status: "published" },
    orderBy: { weekStart: "desc" },
    include: {
      recommendations: {
        orderBy: { sortOrder: "asc" },
        include: { repository: true },
      },
    },
  })

  if (!article || article.recommendations.length === 0) {
    return out({ ok: true, issue: 0, dateKey: dayKey(), picks: [] })
  }

  const recs = article.recommendations.slice(0, limit).map(
    (r) => ({
      fullName: r.repository.fullName,
      name: r.repository.name,
      description: r.repository.description,
      url: r.repository.url,
      language: r.repository.language,
      stars: r.repository.stars,
      forks: r.repository.forks,
      category: r.category,
      reason: r.reason,
      tutorial: r.repository.tutorial,
    }),
  )

  out({
    ok: true,
    issue: article.issue,
    dateKey: dayKey(article.weekStart),
    title: article.title,
    picks: recs,
  })
}

async function cmdHistory(action: string, fullName?: string) {
  if (action === "clear") {
    await prisma.recommendation.deleteMany({})
    return out({ ok: true, action: "clear", message: "去重表已清空" })
  }

  if (action === "remove" && fullName) {
    const repo = await prisma.repository.findUnique({ where: { fullName } })
    if (!repo) return out({ ok: false, action: "remove", fullName, error: "项目不存在" })
    await prisma.recommendation.deleteMany({ where: { repositoryId: repo.id } })
    return out({ ok: true, action: "remove", fullName })
  }

  // list
  const repos = await prisma.repository.findMany({
    where: { recommendations: { some: {} } },
    select: { fullName: true },
    orderBy: { fullName: "asc" },
  })
  out({ ok: true, action: "list", count: repos.length, fullNames: repos.map((r) => r.fullName) })
}

async function cmdRuns(limit = 5) {
  const runs = await prisma.jobRun.findMany({
    where: { jobType: "daily-update" },
    orderBy: { startedAt: "desc" },
    take: limit,
  })
  out({
    ok: true,
    runs: runs.map((r) => ({
      id: r.id,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt?.toISOString() ?? null,
      log: r.log,
    })),
  })
}

async function cmdRun() {
  // 先查今天是不是已经生成过了
  const latest = await prisma.article.findFirst({ orderBy: { weekStart: "desc" } })
  if (latest && dayKey(latest.weekStart) === dayKey()) {
    return out({
      ok: false,
      blocked: true,
      hint: `今天（${dayKey()}）已经生成过第 ${latest.issue} 期了。要强制重跑请用 npm run update:daily。`,
    })
  }

  // ⚠️ Electron 进程 PATH 上没有 npm ⇒ 不能 spawn('npm', ...)
  //    跟 lib/run.mjs 同策略：用当前 Node 进程直接跑 tsx + update-daily.ts
  const tsxCli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs")
  const start = Date.now()
  return new Promise<void>((resolve, _reject) => {
    const child = spawn(process.execPath, [tsxCli, "scripts/update-daily.ts"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8") })
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8") })

    child.on("exit", async (code) => {
      const ms = Date.now() - start
      const run = await prisma.jobRun.findFirst({
        where: { jobType: "daily-update" },
        orderBy: { startedAt: "desc" },
      })
      if (code !== 0 || run?.status !== "success") {
        return out({
          ok: false,
          ms,
          exitCode: code,
          runStatus: run?.status ?? "unknown",
          error: run?.log ?? stderr.slice(-500),
          stdoutTail: stdout.slice(-300),
        })
      }
      // 成功 → 取最新期
      const article = await prisma.article.findFirst({
        where: { status: "published" },
        orderBy: { weekStart: "desc" },
        include: {
          recommendations: {
            include: { repository: true },
          },
        },
      })
      out({
        ok: true,
        issue: article?.issue,
        picked: article?.recommendations.length ?? 0,
        withTutorial: article?.recommendations.filter((r) => r.repository.tutorial).length ?? 0,
        ms,
      })
      resolve()
    })
    child.on("error", async (err) => {
      out({ ok: false, error: String(err.message ?? err), ms: Date.now() - start })
      resolve()
    })
  })
}

// =========== 主入口 ===========

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const cmd = argv[0]
  if (!cmd) die("用法: npx tsx scripts/dsh-bridge.ts <status|picks|history|runs|run> [--limit N] [--remove fullName] [--clear]")

  const getFlag = (name: string, fallback = ""): string => {
    const i = argv.indexOf(name)
    if (i < 0 || i + 1 >= argv.length) return fallback
    return argv[i + 1]
  }

  switch (cmd) {
    case "status":
      return cmdStatus()
    case "picks":
      return cmdPicks(Number(getFlag("--limit", "10")))
    case "history": {
      if (argv.includes("--clear")) return cmdHistory("clear")
      const fullName = getFlag("--remove")
      if (fullName) return cmdHistory("remove", fullName)
      // ⚠️ 认不出的 flag 必须报错：原来这里直接落到 list，
      //    传 `--add x/y` 会静默返回列表，看着"成功"其实啥也没干。
      const unknown = argv.slice(1).filter((a) => a.startsWith("--") && a !== "--limit")
      if (unknown.length) die(`history 不认识的参数: ${unknown.join(" ")}（可用: --clear | --remove <fullName>）`)
      return cmdHistory("list")
    }
    case "runs":
      return cmdRuns(Number(getFlag("--limit", "5")))
    case "run":
      return cmdRun()
    default:
      die(`未知子命令: ${cmd}`)
  }
}

main().finally(() => prisma.$disconnect())