/**
 * 清理过期的 AI Buddy 会话。
 *
 * 会话里存的是用户真实问过的问题，不该无限期留着。过期会话本来就不会再被续写
 * （resolveSession 会拒绝），但数据还在库里——这一步是真正把它删掉。
 * 挂在日更任务里跑，一天一次足够。
 *
 * 退出码永远是 0：清理失败不该让整条日更流水线变红。
 */

import "dotenv/config";
import { purgeExpiredSessions, SESSION_TTL_DAYS } from "../src/lib/chat-session";

async function main() {
  const removed = await purgeExpiredSessions();
  // 顺带报告一下当前留存多少会话，方便发现异常增长
  console.log(
      `🧹 会话清理完成：删除 ${removed} 个超过 ${SESSION_TTL_DAYS} 天未活跃的会话`,
  );
}

main()
  .catch((err) => {
    console.warn("会话清理失败（不影响主流程）：", err instanceof Error ? err.message : err);
  })
  .finally(() => {
    process.exit(0);
  });
