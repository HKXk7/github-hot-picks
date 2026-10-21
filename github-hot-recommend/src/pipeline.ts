import { db, initSchema } from "./db";
import { fetchCandidateRepos } from "./fetch";
import { filterTop } from "./filter";
import { generate, dayLabel } from "./generate";
import { readRecommendedNames, recordRecommended } from "./history";

export interface PipelineResult {
  issueId: number;
  day: string;
  title: string;
  count: number;
  markdownPath: string;
}

// 核心管线：抓取 → 筛选 → 生成，并在 runs 表记录执行情况
export async function runPipeline(trigger = "manual", topN = 10): Promise<PipelineResult> {
  initSchema();
  const startedAt = new Date().toISOString();
  const runId = Number(
    db
      .prepare("INSERT INTO runs (trigger, status, started_at) VALUES (?, 'running', ?)")
      .run(trigger, startedAt).lastInsertRowid,
  );

  try {
    const repos = await fetchCandidateRepos();
    // 历史去重：排除往期已推荐过的项目，保证每期不重复
    const already = readRecommendedNames(dayLabel().day);
    const top = filterTop(repos, topN, already);
    if (top.length === 0) {
      throw new Error("没有筛选出任何项目，请稍后重试或调低 star 门槛");
    }
    const result = generate(top);
    // 存档：把本期推荐写回 JSON，作为下次去重的依据
    recordRecommended(result.day, top.map((r) => r.full_name));
    db.prepare(
      "UPDATE runs SET status='success', project_count=?, finished_at=? WHERE id=?",
    ).run(top.length, new Date().toISOString(), runId);
    return { ...result, count: top.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.prepare("UPDATE runs SET status='failed', error=?, finished_at=? WHERE id=?").run(
      msg,
      new Date().toISOString(),
      runId,
    );
    throw err;
  }
}
