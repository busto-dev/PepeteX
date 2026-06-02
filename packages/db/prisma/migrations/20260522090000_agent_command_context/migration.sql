-- Add internal natural-language Studio command runs.
ALTER TYPE "GenerationRunKind" ADD VALUE 'AGENT_COMMAND';
ALTER TYPE "DeckRevisionSource" ADD VALUE 'AI_STUDIO_COMMAND';

ALTER TABLE "GenerationRun"
  ADD COLUMN "targetElementId" TEXT,
  ADD COLUMN "commandContextJson" JSONB;
