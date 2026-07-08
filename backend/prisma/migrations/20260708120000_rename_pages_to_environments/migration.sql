-- Rename "pages" table to "environments" (data preserved)
ALTER TABLE "pages" RENAME TO "environments";

-- Track which environment produced a given test
ALTER TABLE "test_actions" ADD COLUMN "environmentId" INTEGER;
ALTER TABLE "test_actions" ADD COLUMN "environmentName" TEXT;
