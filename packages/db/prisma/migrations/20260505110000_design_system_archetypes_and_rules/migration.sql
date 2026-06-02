-- Add archetypes and rules columns to DesignSystemVersion
ALTER TABLE "DesignSystemVersion"
  ADD COLUMN "archetypesJson" Json,
  ADD COLUMN "rulesJson" Json;
