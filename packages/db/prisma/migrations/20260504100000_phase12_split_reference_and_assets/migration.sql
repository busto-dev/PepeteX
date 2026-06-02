-- Create enums
CREATE TYPE "FilePurpose" AS ENUM ('REFERENCE', 'ASSET');
CREATE TYPE "AssetRole" AS ENUM ('LOGO', 'IMAGE', 'OTHER');

-- Add purpose and assetRole to ReferenceFile
ALTER TABLE "ReferenceFile" ADD COLUMN "purpose" "FilePurpose" NOT NULL DEFAULT 'REFERENCE';
ALTER TABLE "ReferenceFile" ADD COLUMN "assetRole" "AssetRole";

-- Add purpose and assetRole to DesignSystemReferenceFile
ALTER TABLE "DesignSystemReferenceFile" ADD COLUMN "purpose" "FilePurpose" NOT NULL DEFAULT 'REFERENCE';
ALTER TABLE "DesignSystemReferenceFile" ADD COLUMN "assetRole" "AssetRole";

-- Backfill DesignSystemReferenceFile: logo/brand-image images become assets
UPDATE "DesignSystemReferenceFile"
SET "purpose" = 'ASSET', "assetRole" = 'LOGO'
WHERE "role" = 'logo' AND "mimeType" LIKE 'image/%';

UPDATE "DesignSystemReferenceFile"
SET "purpose" = 'ASSET', "assetRole" = 'IMAGE'
WHERE "role" = 'brand-image' AND "mimeType" LIKE 'image/%';

-- Add indexes
CREATE INDEX "ReferenceFile_deckId_purpose_idx" ON "ReferenceFile"("deckId", "purpose");
CREATE INDEX "DesignSystemReferenceFile_designSystemId_purpose_idx" ON "DesignSystemReferenceFile"("designSystemId", "purpose");
