-- Extend PromptExample with pre-selected bundle metadata.
ALTER TABLE "PromptExample"
  ADD COLUMN "designSystemId"    TEXT,
  ADD COLUMN "customPromptId"    TEXT,
  ADD COLUMN "textProviderKind"  TEXT,
  ADD COLUMN "textModelId"       TEXT,
  ADD COLUMN "imageEnabled"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "imageProviderKind" TEXT,
  ADD COLUMN "imageModelId"      TEXT;

ALTER TABLE "PromptExample"
  ADD CONSTRAINT "PromptExample_designSystemId_fkey"
    FOREIGN KEY ("designSystemId") REFERENCES "DesignSystem"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "PromptExample_customPromptId_fkey"
    FOREIGN KEY ("customPromptId") REFERENCES "CustomPrompt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "PromptExample_designSystemId_idx" ON "PromptExample"("designSystemId");
CREATE INDEX "PromptExample_customPromptId_idx" ON "PromptExample"("customPromptId");

-- Template-scoped reference / asset files.
CREATE TABLE "PromptExampleReferenceFile" (
  "id"                TEXT NOT NULL,
  "promptExampleId"   TEXT NOT NULL,
  "purpose"           "FilePurpose" NOT NULL DEFAULT 'REFERENCE',
  "assetRole"         "AssetRole",
  "originalFilename"  TEXT NOT NULL,
  "mimeType"          TEXT NOT NULL,
  "extension"         TEXT NOT NULL,
  "sizeBytes"         INTEGER NOT NULL,
  "pageCount"         INTEGER,
  "imageWidth"        INTEGER,
  "imageHeight"       INTEGER,
  "storageBucket"     TEXT NOT NULL,
  "storageObjectPath" TEXT NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PromptExampleReferenceFile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PromptExampleReferenceFile_promptExampleId_fkey"
    FOREIGN KEY ("promptExampleId") REFERENCES "PromptExample"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PromptExampleReferenceFile_promptExampleId_purpose_idx"
  ON "PromptExampleReferenceFile"("promptExampleId", "purpose");
CREATE INDEX "PromptExampleReferenceFile_promptExampleId_createdAt_idx"
  ON "PromptExampleReferenceFile"("promptExampleId", "createdAt");
