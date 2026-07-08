-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "testsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "test_aliases" (
    "testkey" TEXT NOT NULL PRIMARY KEY,
    "alias" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "run_history" (
    "filename" TEXT NOT NULL PRIMARY KEY,
    "durationsJson" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "allJson" TEXT NOT NULL,
    "failedJson" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "test_actions" (
    "testname" TEXT NOT NULL PRIMARY KEY,
    "file" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "actionsJson" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "test_prompts" (
    "testname" TEXT NOT NULL PRIMARY KEY,
    "messagesJson" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "saved_chats" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "filename" TEXT NOT NULL,
    "messagesJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "saved_chats_filename_key" ON "saved_chats"("filename");
