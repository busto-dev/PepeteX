-- Add Mastra-native agent execution metadata to app-facing generation runs.
ALTER TABLE "GenerationRun"
  ADD COLUMN "mastraResourceId" TEXT,
  ADD COLUMN "mastraThreadId" TEXT,
  ADD COLUMN "mastraRunId" TEXT,
  ADD COLUMN "agentTraceId" TEXT,
  ADD COLUMN "agentMode" TEXT,
  ADD COLUMN "agentStepCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "inputTokensUsed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "outputTokensUsed" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "GenerationToolCall"
  ADD COLUMN "mastraToolCallId" TEXT;

CREATE INDEX "GenerationRun_mastraResourceId_idx" ON "GenerationRun"("mastraResourceId");
CREATE INDEX "GenerationRun_mastraThreadId_idx" ON "GenerationRun"("mastraThreadId");
CREATE INDEX "GenerationRun_mastraRunId_idx" ON "GenerationRun"("mastraRunId");
CREATE INDEX "GenerationToolCall_runId_mastraToolCallId_idx" ON "GenerationToolCall"("runId", "mastraToolCallId");
