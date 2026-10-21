import { runPipeline } from "./pipeline";

// 命令行入口：npm run build
// 触发来源可由环境变量指定（本地 manual，CI 里 schedule），便于 runs 表区分
const trigger = process.env.PIPELINE_TRIGGER ?? "manual";
runPipeline(trigger, 10)
  .then((r) => {
    console.log(`完成：${r.title}`);
    console.log(`推荐 ${r.count} 个项目`);
    console.log(`Markdown：${r.markdownPath}`);
  })
  .catch((err) => {
    console.error("失败：", err instanceof Error ? err.message : err);
    process.exit(1);
  });
