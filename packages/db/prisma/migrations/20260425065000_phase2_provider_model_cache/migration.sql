-- CreateTable
CREATE TABLE "ProviderModelCache" (
    "id" TEXT NOT NULL,
    "providerDefinitionId" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "modelsJson" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderModelCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderModelCache_providerDefinitionId_cacheKey_key" ON "ProviderModelCache"("providerDefinitionId", "cacheKey");

-- CreateIndex
CREATE INDEX "ProviderModelCache_providerDefinitionId_expiresAt_idx" ON "ProviderModelCache"("providerDefinitionId", "expiresAt");

-- AddForeignKey
ALTER TABLE "ProviderModelCache" ADD CONSTRAINT "ProviderModelCache_providerDefinitionId_fkey" FOREIGN KEY ("providerDefinitionId") REFERENCES "ProviderDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
