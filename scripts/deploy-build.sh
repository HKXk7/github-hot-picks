#!/usr/bin/env bash
# 发布沙箱里的构建入口。工具只给「一条 install 命令」，而 Next 项目要
# 装依赖 → 生成 Prisma 客户端 → build 三步，所以收成一个脚本。
set -euo pipefail
cd "$(dirname "$0")/.."

# prisma.config.ts 对 DATABASE_URL 是硬校验，任何 prisma CLI 都要它在位。
# 部署版不依赖数据库（站点走 public/data 静态包），指向一个不存在的文件即可：
# 查询会抛错，site-data 会安静地回退到静态包。
export DATABASE_URL="file:$(pwd)/prisma/dev.db"

# 若提供了 .deploy-env（本地文件，不入库），把它当作运行时环境变量来源。
# 用于注入分享链接等「构建完才知道」的值。
if [ -f .deploy-env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.deploy-env
  set +a
fi

npm ci
npx prisma generate
npm run build
