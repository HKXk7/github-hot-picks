-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Repository" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "githubId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT NOT NULL,
    "language" TEXT,
    "stars" INTEGER NOT NULL,
    "forks" INTEGER NOT NULL,
    "fetchedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tutorial" TEXT,
    "tutorialError" TEXT,
    "tutorialAttempts" INTEGER NOT NULL DEFAULT 0,
    "tutorialFailedAt" DATETIME
);
INSERT INTO "new_Repository" ("createdAt", "description", "fetchedAt", "forks", "fullName", "githubId", "id", "language", "name", "stars", "tutorial", "url") SELECT "createdAt", "description", "fetchedAt", "forks", "fullName", "githubId", "id", "language", "name", "stars", "tutorial", "url" FROM "Repository";
DROP TABLE "Repository";
ALTER TABLE "new_Repository" RENAME TO "Repository";
CREATE UNIQUE INDEX "Repository_githubId_key" ON "Repository"("githubId");
CREATE UNIQUE INDEX "Repository_fullName_key" ON "Repository"("fullName");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
