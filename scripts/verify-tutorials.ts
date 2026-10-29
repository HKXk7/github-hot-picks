/**
 * 离线体检：扫一遍数据库里所有教程，判断它们是否符合 schema。
 *
 * 用法：npx tsx scripts/verify-tutorials.ts
 *
 * 三种判定：
 * - 结构化通过：{"v":2,...} 且通过 Zod 校验
 * - 旧版 Markdown：不是 JSON，属于改造前遗留的数据，正常
 * - 损坏：看着像 JSON（以 { 开头）却解析或校验失败 —— 这才是真问题
 */
import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { TutorialSchema, TUTORIAL_VERSION, parseStructuredTutorial } from "../src/lib/tutorial/schema";

const prisma = new PrismaClient();

interface Row {
  fullName: string;
  tutorial: string | null;
}

type Verdict = "structured" | "legacy" | "broken";

function judge(raw: string): { verdict: Verdict; detail?: string } {
  if (parseStructuredTutorial(raw)) return { verdict: "structured" };

  if (raw.trimStart().startsWith("{")) {
    // 长得像 JSON 却没通过校验，大概率是生成时写坏了，必须暴露出来
    const detail = describeFailure(raw);
    return { verdict: "broken", detail };
  }

  return { verdict: "legacy" };
}

function describeFailure(raw: string): string {
  try {
    const result = TutorialSchema.safeParse(JSON.parse(raw));
    if (result.success) return "意外成功";
    return result.error.issues
      .map((i) => `${i.path.join(".") || "(根)"}: ${i.message}`)
      .join("；");
  } catch (e) {
    return `JSON 无法解析：${e instanceof Error ? e.message : String(e)}`;
  }
}

function pad(s: string, n: number): string {
  // 中文宽度按 2 算，控制台才对得齐
  const width = [...s].reduce((w, ch) => w + (/[\u4e00-\u9fa5（）]/.test(ch) ? 2 : 1), 0);
  return s + " ".repeat(Math.max(0, n - width));
}

async function main() {
  const rows: Row[] = await prisma.repository.findMany({
    where: { tutorial: { not: null } },
    select: { fullName: true, tutorial: true },
    orderBy: { fullName: "asc" },
  });

  const total = await prisma.repository.count();
  console.log(`数据库共有 ${total} 个仓库，其中 ${rows.length} 个带教程\n`);

  const counts: Record<Verdict, number> = { structured: 0, legacy: 0, broken: 0 };
  const brokenRows: { fullName: string; detail: string }[] = [];
  const confidence: Record<string, number> = { high: 0, medium: 0, low: 0 };
  let cmdTotal = 0;

  console.log(pad("判定", 12) + pad("项目", 46) + pad("把握度", 8) + "命令数");
  console.log("-".repeat(78));

  for (const row of rows) {
    const raw = row.tutorial!;
    const { verdict, detail } = judge(raw);

    let c = "-";
    let cmds = "-";
    const parsed = parseStructuredTutorial(raw);
    if (parsed) {
      c = parsed.confidence;
      cmds = String(parsed.installCommands.length);
      confidence[parsed.confidence] += 1;
      cmdTotal += parsed.installCommands.length;
    }

    console.log(
      pad(
        verdict === "structured" ? `结构化 v${TUTORIAL_VERSION}` : verdict === "legacy" ? "旧版 Markdown" : "损坏",
        16,
      ) + pad(row.fullName.slice(0, 44), 46) + pad(c, 8) + cmds,
    );

    counts[verdict] += 1;
    if (verdict === "broken") brokenRows.push({ fullName: row.fullName, detail: detail ?? "" });
  }

  console.log("-".repeat(78));
  console.log(
    `结构化 ${counts.structured} 条 | 旧版 Markdown ${counts.legacy} 条 | 损坏 ${counts.broken} 条`,
  );
  if (counts.structured > 0) {
    console.log(
      `把握度分布：high ${confidence.high} / medium ${confidence.medium} / low ${confidence.low}` +
        ` | 平均每份教程 ${(cmdTotal / counts.structured).toFixed(1)} 条安装命令`,
    );
  }

  if (brokenRows.length > 0) {
    console.log("\n以下教程损坏，需要重新生成：");
    for (const b of brokenRows) console.log(`  - ${b.fullName}：${b.detail}`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log("\n全部教程校验通过");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("体检失败：", err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
