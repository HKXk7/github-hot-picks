-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repoFullName" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "embedding" TEXT,
    "embeddedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "KnowledgeChunk_repoFullName_idx" ON "KnowledgeChunk"("repoFullName");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeChunk_repoFullName_source_key" ON "KnowledgeChunk"("repoFullName", "source");
