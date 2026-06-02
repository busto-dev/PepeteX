-- AlterEnum for DeckRevisionSource — add new AI generation sources
ALTER TYPE "DeckRevisionSource" ADD VALUE IF NOT EXISTS 'AI_FULL_DECK_GENERATED';
ALTER TYPE "DeckRevisionSource" ADD VALUE IF NOT EXISTS 'AI_SINGLE_SLIDE_INSERTED';
ALTER TYPE "DeckRevisionSource" ADD VALUE IF NOT EXISTS 'AI_SLIDE_REGENERATED';

-- CreateEnum GenerationRunKind
CREATE TYPE "GenerationRunKind" AS ENUM (
  'FULL_DECK',
  'SINGLE_SLIDE',
  'REGENERATE_SLIDE',
  'APPLY_COMMENTS',
  'APPLY_TWEAKS',
  'GENERATE_IMAGE',
  'REGENERATE_IMAGE'
);

-- CreateEnum GenerationRunStatus
CREATE TYPE "GenerationRunStatus" AS ENUM (
  'PENDING',
  'RUNNING',
  'WAITING_ASK',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

-- CreateEnum ImageGenerationStatus
CREATE TYPE "ImageGenerationStatus" AS ENUM (
  'PENDING',
  'COMPLETED',
  'FAILED'
);

-- AlterTable Deck — add last-used provider/model tracking
ALTER TABLE "Deck"
  ADD COLUMN "lastUsedTextProviderId" TEXT,
  ADD COLUMN "lastUsedTextModelId"    TEXT;

-- CreateTable GenerationRun
CREATE TABLE "GenerationRun" (
  "id"                   TEXT NOT NULL,
  "deckId"               TEXT NOT NULL,
  "workspaceId"          TEXT NOT NULL,
  "createdByUserId"      TEXT NOT NULL,
  "kind"                 "GenerationRunKind" NOT NULL,
  "status"               "GenerationRunStatus" NOT NULL DEFAULT 'PENDING',
  "textProviderId"       TEXT,
  "textModelId"          TEXT,
  "imageEnabled"         BOOLEAN NOT NULL DEFAULT false,
  "imageProviderId"      TEXT,
  "imageModelId"         TEXT,
  "customPromptId"       TEXT,
  "designSystemId"       TEXT,
  "languageCode"         TEXT NOT NULL DEFAULT 'en',
  "contentAccuracyMode"  BOOLEAN NOT NULL DEFAULT false,
  "manualInstruction"    TEXT,
  "targetSlideId"        TEXT,
  "slideInstruction"     TEXT,
  "askQuestion"          TEXT,
  "askOptionsJson"       JSONB,
  "askAllowManualAnswer" BOOLEAN NOT NULL DEFAULT true,
  "pendingAskAnswer"     TEXT,
  "resultRevisionId"     TEXT,
  "aiSummary"            TEXT,
  "errorMessage"         TEXT,
  "startedAt"            TIMESTAMP(3),
  "completedAt"          TIMESTAMP(3),
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GenerationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable GeneratedImage
CREATE TABLE "GeneratedImage" (
  "id"              TEXT NOT NULL,
  "deckId"          TEXT NOT NULL,
  "generationRunId" TEXT,
  "slideId"         TEXT,
  "elementId"       TEXT,
  "prompt"          TEXT NOT NULL,
  "revisedPrompt"   TEXT,
  "model"           TEXT NOT NULL,
  "providerKind"    TEXT NOT NULL,
  "gcsBucket"       TEXT,
  "gcsPath"         TEXT,
  "mimeType"        TEXT NOT NULL DEFAULT 'image/png',
  "width"           INTEGER,
  "height"          INTEGER,
  "status"          "ImageGenerationStatus" NOT NULL DEFAULT 'PENDING',
  "errorMessage"    TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GeneratedImage_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey GenerationRun → Deck
ALTER TABLE "GenerationRun"
  ADD CONSTRAINT "GenerationRun_deckId_fkey"
  FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey GenerationRun → User
ALTER TABLE "GenerationRun"
  ADD CONSTRAINT "GenerationRun_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey GeneratedImage → Deck
ALTER TABLE "GeneratedImage"
  ADD CONSTRAINT "GeneratedImage_deckId_fkey"
  FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey GeneratedImage → GenerationRun
ALTER TABLE "GeneratedImage"
  ADD CONSTRAINT "GeneratedImage_generationRunId_fkey"
  FOREIGN KEY ("generationRunId") REFERENCES "GenerationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey GeneratedImage → User
ALTER TABLE "GeneratedImage"
  ADD CONSTRAINT "GeneratedImage_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "GenerationRun_deckId_createdAt_idx" ON "GenerationRun"("deckId", "createdAt");
CREATE INDEX "GenerationRun_createdByUserId_createdAt_idx" ON "GenerationRun"("createdByUserId", "createdAt");
CREATE INDEX "GenerationRun_status_createdAt_idx" ON "GenerationRun"("status", "createdAt");
CREATE INDEX "GenerationRun_workspaceId_createdAt_idx" ON "GenerationRun"("workspaceId", "createdAt");

CREATE INDEX "GeneratedImage_deckId_createdAt_idx" ON "GeneratedImage"("deckId", "createdAt");
CREATE INDEX "GeneratedImage_generationRunId_idx" ON "GeneratedImage"("generationRunId");
CREATE INDEX "GeneratedImage_createdByUserId_createdAt_idx" ON "GeneratedImage"("createdByUserId", "createdAt");
