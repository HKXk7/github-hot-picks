#!/usr/bin/env bash
# 发布沙箱的启动入口：必须监听 $PORT 且绑定 0.0.0.0。
set -euo pipefail
cd "$(dirname "$0")/.."

# 部署版不依赖数据库：站点走 public/data 静态包。给一个不存在的 DB 路径，
# Prisma 查询会抛错，site-data 会安静回退到静态包（这正是设计好的降级路径）。
export DATABASE_URL="file:$(pwd)/prisma/dev.db"

# 线上那份代码是构建时的快照，日更 bot 更新的是 GitHub 仓库里的 JSON。
# 配了它，站点每 10 分钟拉一次最新数据，不用为了一期新推荐重新部署。
# 本地自托管想关掉同步：SITE_SNAPSHOT_BASE="" npm start
if [ -z "${SITE_SNAPSHOT_BASE+x}" ]; then
  export SITE_SNAPSHOT_BASE="https://api.github.com/repos/HKXk7/github-hot-picks/contents/public/data"
fi

# 构建完才知道分享链接时，把它写进 .deploy-env（本地文件，不入库）
if [ -f .deploy-env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.deploy-env
  set +a
fi

export PORT="${PORT:-3000}"
exec ./node_modules/.bin/next start -p "$PORT" -H 0.0.0.0
