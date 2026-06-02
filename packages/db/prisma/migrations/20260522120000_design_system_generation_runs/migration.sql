-- CreateEnum
CREATE TYPE "DesignSystemGenerationRunKind" AS ENUM ('DS_AGENT_COMMAND', 'DS_FULL_GENERATE');

-- AlterTable
ALTER TABLE "DesignSystemVersion" ADD COLUMN     "documentJson" JSONB;

-- AlterTable
ALTER TABLE "GeneratedImage" ADD COLUMN     "designSystemGenerationRunId" TEXT,
ADD COLUMN     "designSystemId" TEXT,
ALTER COLUMN "deckId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "DesignSystemGenerationRun" (
    "id" TEXT NOT NULL,
    "designSystemId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "kind" "DesignSystemGenerationRunKind" NOT NULL,
    "status" "GenerationRunStatus" NOT NULL DEFAULT 'PENDING',
    "textProviderId" TEXT,
    "textModelId" TEXT,
    "imageEnabled" BOOLEAN NOT NULL DEFAULT false,
    "imageProviderId" TEXT,
    "imageModelId" TEXT,
    "languageCode" TEXT NOT NULL DEFAULT 'en',
    "manualInstruction" TEXT,
    "feedbackContextJson" JSONB,
    "askQuestion" TEXT,
    "askOptionsJson" JSONB,
    "askAllowManualAnswer" BOOLEAN NOT NULL DEFAULT true,
    "pendingAskAnswer" TEXT,
    "mastraResourceId" TEXT,
    "mastraThreadId" TEXT,
    "mastraRunId" TEXT,
    "agentTraceId" TEXT,
    "agentMode" TEXT,
    "agentStepCount" INTEGER NOT NULL DEFAULT 0,
    "inputTokensUsed" INTEGER NOT NULL DEFAULT 0,
    "outputTokensUsed" INTEGER NOT NULL DEFAULT 0,
    "resultVersionId" TEXT,
    "aiSummary" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignSystemGenerationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignSystemGenerationMessage" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "role" "GenerationMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignSystemGenerationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignSystemGenerationToolCall" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "mastraToolCallId" TEXT,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "GenerationToolCallStatus" NOT NULL DEFAULT 'RUNNING',
    "inputJson" JSONB,
    "resultJson" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignSystemGenerationToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignSystemGenerationCheckpoint" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "status" "GenerationCheckpointStatus" NOT NULL DEFAULT 'DRAFT',
    "summary" TEXT,
    "documentJson" JSONB NOT NULL,
    "validationJson" JSONB,
    "versionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignSystemGenerationCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DesignSystemGenerationRun_designSystemId_createdAt_idx" ON "DesignSystemGenerationRun"("designSystemId", "createdAt");

-- CreateIndex
CREATE INDEX "DesignSystemGenerationRun_createdByUserId_createdAt_idx" ON "DesignSystemGenerationRun"("createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "DesignSystemGenerationRun_mastraResourceId_idx" ON "DesignSystemGenerationRun"("mastraResourceId");

-- CreateIndex
CREATE INDEX "DesignSystemGenerationRun_mastraThreadId_idx" ON "DesignSystemGenerationRun"("mastraThreadId");

-- CreateIndex
CREATE INDEX "DesignSystemGenerationRun_mastraRunId_idx" ON "DesignSystemGenerationRun"("mastraRunId");

-- CreateIndex
CREATE INDEX "DesignSystemGenerationRun_status_createdAt_idx" ON "DesignSystemGenerationRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DesignSystemGenerationMessage_runId_createdAt_idx" ON "DesignSystemGenerationMessage"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "DesignSystemGenerationToolCall_runId_createdAt_idx" ON "DesignSystemGenerationToolCall"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "DesignSystemGenerationToolCall_runId_mastraToolCallId_idx" ON "DesignSystemGenerationToolCall"("runId", "mastraToolCallId");

-- CreateIndex
CREATE INDEX "DesignSystemGenerationToolCall_runId_status_createdAt_idx" ON "DesignSystemGenerationToolCall"("runId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DesignSystemGenerationCheckpoint_runId_createdAt_idx" ON "DesignSystemGenerationCheckpoint"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "DesignSystemGenerationCheckpoint_runId_status_createdAt_idx" ON "DesignSystemGenerationCheckpoint"("runId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "GeneratedImage_designSystemId_createdAt_idx" ON "GeneratedImage"("designSystemId", "createdAt");

-- CreateIndex
CREATE INDEX "GeneratedImage_designSystemGenerationRunId_idx" ON "GeneratedImage"("designSystemGenerationRunId");

-- AddForeignKey
ALTER TABLE "DesignSystemGenerationRun" ADD CONSTRAINT "DesignSystemGenerationRun_designSystemId_fkey" FOREIGN KEY ("designSystemId") REFERENCES "DesignSystem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignSystemGenerationRun" ADD CONSTRAINT "DesignSystemGenerationRun_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignSystemGenerationMessage" ADD CONSTRAINT "DesignSystemGenerationMessage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DesignSystemGenerationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignSystemGenerationToolCall" ADD CONSTRAINT "DesignSystemGenerationToolCall_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DesignSystemGenerationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignSystemGenerationCheckpoint" ADD CONSTRAINT "DesignSystemGenerationCheckpoint_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DesignSystemGenerationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedImage" ADD CONSTRAINT "GeneratedImage_designSystemId_fkey" FOREIGN KEY ("designSystemId") REFERENCES "DesignSystem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedImage" ADD CONSTRAINT "GeneratedImage_designSystemGenerationRunId_fkey" FOREIGN KEY ("designSystemGenerationRunId") REFERENCES "DesignSystemGenerationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

