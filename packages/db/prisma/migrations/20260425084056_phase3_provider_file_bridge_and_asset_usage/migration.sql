ALTER TABLE "ReferenceFile"
ADD COLUMN "providerFileId" TEXT,
ADD COLUMN "providerDefinitionId" TEXT;

CREATE TABLE "AssetUsage" (
    "id" TEXT NOT NULL,
    "referenceFileId" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "contextId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReferenceFile_providerDefinitionId_idx" ON "ReferenceFile"("providerDefinitionId");

CREATE INDEX "AssetUsage_referenceFileId_createdAt_idx" ON "AssetUsage"("referenceFileId", "createdAt");

CREATE INDEX "AssetUsage_context_contextId_idx" ON "AssetUsage"("context", "contextId");

ALTER TABLE "ReferenceFile"
ADD CONSTRAINT "ReferenceFile_providerDefinitionId_fkey"
FOREIGN KEY ("providerDefinitionId") REFERENCES "ProviderDefinition"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AssetUsage"
ADD CONSTRAINT "AssetUsage_referenceFileId_fkey"
FOREIGN KEY ("referenceFileId") REFERENCES "ReferenceFile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
