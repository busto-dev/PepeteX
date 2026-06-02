-- Retire the legacy design system columns; documentJson (V2 bucketed) is now canonical.
ALTER TABLE "DesignSystemVersion" DROP COLUMN "archetypesJson",
DROP COLUMN "componentsJson",
DROP COLUMN "exampleSlidesJson",
DROP COLUMN "rulesJson",
DROP COLUMN "tokensJson",
ALTER COLUMN "documentJson" SET NOT NULL;
