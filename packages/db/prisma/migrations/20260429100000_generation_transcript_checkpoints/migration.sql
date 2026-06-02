-- CreateEnum GenerationMessageRole
CREATE TYPE "GenerationMessageRole" AS ENUM (
  'USER',
  'ASSISTANT',
  'SYSTEM',
  'VERIFIER'
);

-- CreateEnum GenerationToolCallStatus
CREATE TYPE "GenerationToolCallStatus" AS ENUM (
  'RUNNING',
  'COMPLETED',
  'FAILED'
);

-- CreateEnum GenerationCheckpointStatus
CREATE TYPE "GenerationCheckpointStatus" AS ENUM (
  'DRAFT',
  'VALIDATED',
  'VALIDATION_FAILED',
  'COMMITTED'
);

-- CreateTable GenerationMessage
CREATE TABLE "GenerationMessage" (
  "id"        TEXT NOT NULL,
  "runId"     TEXT NOT NULL,
  "role"      "GenerationMessageRole" NOT NULL,
  "content"   TEXT NOT NULL,
  "metadata"  JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GenerationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable GenerationToolCall
CREATE TABLE "GenerationToolCall" (
  "id"           TEXT NOT NULL,
  "runId"        TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "label"        TEXT NOT NULL,
  "status"       "GenerationToolCallStatus" NOT NULL DEFAULT 'RUNNING',
  "inputJson"    JSONB,
  "resultJson"   JSONB,
  "errorMessage" TEXT,
  "startedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"  TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GenerationToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable GenerationCheckpoint
CREATE TABLE "GenerationCheckpoint" (
  "id"             TEXT NOT NULL,
  "runId"          TEXT NOT NULL,
  "status"         "GenerationCheckpointStatus" NOT NULL DEFAULT 'DRAFT',
  "summary"        TEXT,
  "deckJson"       JSONB NOT NULL,
  "validationJson" JSONB,
  "revisionId"     TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GenerationCheckpoint_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey GenerationMessage → GenerationRun
ALTER TABLE "GenerationMessage"
  ADD CONSTRAINT "GenerationMessage_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "GenerationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey GenerationToolCall → GenerationRun
ALTER TABLE "GenerationToolCall"
  ADD CONSTRAINT "GenerationToolCall_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "GenerationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey GenerationCheckpoint → GenerationRun
ALTER TABLE "GenerationCheckpoint"
  ADD CONSTRAINT "GenerationCheckpoint_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "GenerationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "GenerationMessage_runId_createdAt_idx" ON "GenerationMessage"("runId", "createdAt");

CREATE INDEX "GenerationToolCall_runId_createdAt_idx" ON "GenerationToolCall"("runId", "createdAt");
CREATE INDEX "GenerationToolCall_runId_status_createdAt_idx" ON "GenerationToolCall"("runId", "status", "createdAt");

CREATE INDEX "GenerationCheckpoint_runId_createdAt_idx" ON "GenerationCheckpoint"("runId", "createdAt");
CREATE INDEX "GenerationCheckpoint_runId_status_createdAt_idx" ON "GenerationCheckpoint"("runId", "status", "createdAt");