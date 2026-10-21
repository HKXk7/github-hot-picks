import { PrismaClient } from '../generated/prisma/client'

const prisma = new PrismaClient()

async function main() {
  // ── 1. 示例项目（开发/演示用；真实程序运行时改从 GitHub API 抓取）──
  const repos = [
    { githubId: 100001, name: 'react',       fullName: 'facebook/react',           description: '用于构建用户界面的 JavaScript 库', url: 'https://github.com/facebook/react', language: 'JavaScript', stars: 232000, forks: 47600 },
    { githubId: 100002, name: 'next.js',     fullName: 'vercel/next.js',           description: 'The React Framework for the Web', url: 'https://github.com/vercel/next.js', language: 'TypeScript', stars: 130000, forks: 28000 },
    { githubId: 100003, name: 'vscode',      fullName: 'microsoft/vscode',         description: 'Visual Studio Code', url: 'https://github.com/microsoft/vscode', language: 'TypeScript', stars: 168000, forks: 30500 },
    { githubId: 100004, name: 'tailwindcss', fullName: 'tailwindlabs/tailwindcss', description: 'A utility-first CSS framework', url: 'https://github.com/tailwindlabs/tailwindcss', language: 'TypeScript', stars: 86000, forks: 4400 },
    { githubId: 100005, name: 'ollama',      fullName: 'ollama/ollama',            description: '本地运行大语言模型', url: 'https://github.com/ollama/ollama', language: 'Go', stars: 110000, forks: 8700 },
    { githubId: 100006, name: 'langchain',   fullName: 'langchain-ai/langchain',   description: 'Building applications with LLMs', url: 'https://github.com/langchain-ai/langchain', language: 'Python', stars: 105000, forks: 17500 },
    { githubId: 100007, name: 'linux',       fullName: 'torvalds/linux',           description: 'Linux kernel source tree', url: 'https://github.com/torvalds/linux', language: 'C', stars: 186000, forks: 55400 },
    { githubId: 100008, name: 'tauri',       fullName: 'tauri-apps/tauri',         description: '构建更小更快的桌面应用', url: 'https://github.com/tauri-apps/tauri', language: 'Rust', stars: 90000, forks: 2700 },
  ]

  for (const repo of repos) {
    await prisma.repository.upsert({
      where: { githubId: repo.githubId },
      update: repo,
      create: { ...repo, fetchedAt: new Date() },
    })
  }

  // ── 2. 一篇示例推荐稿 ──
  const article = await prisma.article.upsert({
    where: { issue: 1 },
    update: {},
    create: {
      issue: 1,
      title: '第 1 期 · 本周值得关注的 5 个开源项目',
      content: '# 本周推荐\n\n> 这是示例稿，开发阶段用来预览排版效果。\n\n（正文待生成）',
      status: 'draft',
      weekStart: new Date(),
    },
  })

  // ── 3. 推荐关系（第 1 期推荐 5 个项目）──
  const picks = [
    { fullName: 'facebook/react',           reason: '生态最成熟的前端框架', category: '前端', sortOrder: 1 },
    { fullName: 'vercel/next.js',           reason: '全栈框架，上手快',       category: '前端', sortOrder: 2 },
    { fullName: 'ollama/ollama',            reason: '本地跑大模型最简单',     category: 'AI',   sortOrder: 3 },
    { fullName: 'langchain-ai/langchain',   reason: 'AI 应用开发标配',        category: 'AI',   sortOrder: 4 },
    { fullName: 'tailwindlabs/tailwindcss', reason: '写样式快，正好配本项目', category: '前端', sortOrder: 5 },
  ]

  for (const pick of picks) {
    const repo = await prisma.repository.findUnique({ where: { fullName: pick.fullName } })
    if (!repo) continue
    await prisma.recommendation.upsert({
      where: {
        // 注意：这是 @@unique([articleId, repositoryId]) 生成的复合唯一键名
        articleId_repositoryId: { articleId: article.id, repositoryId: repo.id },
      },
      update: { reason: pick.reason, category: pick.category, sortOrder: pick.sortOrder },
      create: {
        articleId: article.id,
        repositoryId: repo.id,
        reason: pick.reason,
        category: pick.category,
        sortOrder: pick.sortOrder,
      },
    })
  }

  console.log('✅ 种子数据填充完成：8 个项目、1 篇稿子、5 条推荐')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
