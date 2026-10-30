import { PrismaClient } from "../generated/prisma/client";

const p = new PrismaClient();

async function main() {
  const count = await p.article.count();
  console.log("Article count:", count);

  const articles = await p.article.findMany({
    orderBy: { issue: "asc" },
    include: {
      recommendations: {
        orderBy: { sortOrder: "asc" },
        include: { repository: true },
      },
    },
  });

  for (const a of articles) {
    console.log(
      `\nIssue #${a.issue} | ${a.title} | status: ${a.status} | ${a.recommendations.length} picks | content: ${a.content.length} chars`,
    );

    for (const r of a.recommendations) {
      const hasTutorial = r.repository.tutorial ? `YES (${r.repository.tutorial.length} chars)` : "NO";
      console.log(`  #${r.sortOrder} ${r.repository.fullName} | tutorial: ${hasTutorial}`);
    }
  }

  if (articles.length === 0) {
    console.log("\n⚠️  No articles found in database. Data is empty!");
  }

  // Also check repositories
  const repoCount = await p.repository.count();
  console.log(`\nRepository count: ${repoCount}`);

  await p.$disconnect();
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});