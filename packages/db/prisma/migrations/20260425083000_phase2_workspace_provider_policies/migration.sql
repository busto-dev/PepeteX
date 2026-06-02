-- CreateTable
CREATE TABLE "WorkspaceProviderPolicy" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "providerDefinitionId" TEXT NOT NULL,
    "allowedModelIdsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceProviderPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceProviderPolicy_workspaceId_providerDefinitionId_key" ON "WorkspaceProviderPolicy"("workspaceId", "providerDefinitionId");

-- CreateIndex
CREATE INDEX "WorkspaceProviderPolicy_workspaceId_createdAt_idx" ON "WorkspaceProviderPolicy"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "WorkspaceProviderPolicy" ADD CONSTRAINT "WorkspaceProviderPolicy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceProviderPolicy" ADD CONSTRAINT "WorkspaceProviderPolicy_providerDefinitionId_fkey" FOREIGN KEY ("providerDefinitionId") REFERENCES "ProviderDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
