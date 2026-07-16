-- CreateTable
CREATE TABLE "ai_queue_tasks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "imagesJson" TEXT,
    "instructions" TEXT,
    "environmentId" INTEGER,
    "seedHistoryJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "runId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME
);
