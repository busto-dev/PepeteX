-- CreateEnum
CREATE TYPE "CustomPromptScope" AS ENUM ('PERSONAL', 'WORKSPACE', 'GLOBAL');

-- CreateTable
CREATE TABLE "CustomPrompt" (
    "id" TEXT NOT NULL,
    "scope" "CustomPromptScope" NOT NULL,
    "ownerUserId" TEXT,
    "workspaceId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "tagsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomPromptVariant" (
    "id" TEXT NOT NULL,
    "customPromptId" TEXT NOT NULL,
    "languageCode" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomPromptVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomPrompt_scope_createdAt_idx" ON "CustomPrompt"("scope", "createdAt");

-- CreateIndex
CREATE INDEX "CustomPrompt_ownerUserId_createdAt_idx" ON "CustomPrompt"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomPrompt_workspaceId_createdAt_idx" ON "CustomPrompt"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomPromptVariant_customPromptId_languageCode_key" ON "CustomPromptVariant"("customPromptId", "languageCode");

-- CreateIndex
CREATE INDEX "CustomPromptVariant_customPromptId_createdAt_idx" ON "CustomPromptVariant"("customPromptId", "createdAt");

-- AddForeignKey
ALTER TABLE "CustomPrompt" ADD CONSTRAINT "CustomPrompt_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomPrompt" ADD CONSTRAINT "CustomPrompt_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomPromptVariant" ADD CONSTRAINT "CustomPromptVariant_customPromptId_fkey" FOREIGN KEY ("customPromptId") REFERENCES "CustomPrompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
