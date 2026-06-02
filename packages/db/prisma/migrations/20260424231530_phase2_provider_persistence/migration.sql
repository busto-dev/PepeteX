-- CreateEnum
CREATE TYPE "ProviderKind" AS ENUM ('GEMINI', 'OPENAI_COMPATIBLE', 'CLIPROXYAPI');

-- CreateEnum
CREATE TYPE "ProviderCredentialScope" AS ENUM ('USER', 'SYSTEM');

-- CreateTable
CREATE TABLE "ProviderDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ProviderKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowUserCredentials" BOOLEAN NOT NULL DEFAULT false,
    "baseUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCredential" (
    "id" TEXT NOT NULL,
    "providerDefinitionId" TEXT NOT NULL,
    "scope" "ProviderCredentialScope" NOT NULL DEFAULT 'USER',
    "ownerUserId" TEXT,
    "label" TEXT NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "apiKeyPreview" TEXT NOT NULL,
    "customHeadersHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderDefinition_name_key" ON "ProviderDefinition"("name");

-- CreateIndex
CREATE INDEX "ProviderDefinition_kind_enabled_idx" ON "ProviderDefinition"("kind", "enabled");

-- CreateIndex
CREATE INDEX "ProviderCredential_providerDefinitionId_scope_idx" ON "ProviderCredential"("providerDefinitionId", "scope");

-- CreateIndex
CREATE INDEX "ProviderCredential_ownerUserId_createdAt_idx" ON "ProviderCredential"("ownerUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProviderCredential" ADD CONSTRAINT "ProviderCredential_providerDefinitionId_fkey" FOREIGN KEY ("providerDefinitionId") REFERENCES "ProviderDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCredential" ADD CONSTRAINT "ProviderCredential_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
