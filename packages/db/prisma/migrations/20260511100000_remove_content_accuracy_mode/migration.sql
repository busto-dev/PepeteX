-- Drop deprecated contentAccuracyMode flag from GenerationRun.
ALTER TABLE "GenerationRun"
  DROP COLUMN IF EXISTS "contentAccuracyMode";
