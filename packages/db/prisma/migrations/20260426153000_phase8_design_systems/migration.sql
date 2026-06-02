-- CreateEnum
CREATE TYPE "DesignSystemScope" AS ENUM ('PERSONAL', 'WORKSPACE', 'GLOBAL');

-- CreateTable
CREATE TABLE "DesignSystem" (
    "id" TEXT NOT NULL,
    "scope" "DesignSystemScope" NOT NULL,
    "ownerUserId" TEXT,
    "workspaceId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "currentVersionNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignSystem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignSystemVersion" (
    "id" TEXT NOT NULL,
    "designSystemId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "summary" TEXT,
    "tokensJson" JSONB NOT NULL,
    "componentsJson" JSONB NOT NULL,
    "exampleSlidesJson" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignSystemVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DesignSystem_scope_createdAt_idx" ON "DesignSystem"("scope", "createdAt");

-- CreateIndex
CREATE INDEX "DesignSystem_ownerUserId_createdAt_idx" ON "DesignSystem"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "DesignSystem_workspaceId_createdAt_idx" ON "DesignSystem"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DesignSystemVersion_designSystemId_versionNumber_key" ON "DesignSystemVersion"("designSystemId", "versionNumber");

-- CreateIndex
CREATE INDEX "DesignSystemVersion_designSystemId_createdAt_idx" ON "DesignSystemVersion"("designSystemId", "createdAt");

-- CreateIndex
CREATE INDEX "DesignSystemVersion_createdByUserId_createdAt_idx" ON "DesignSystemVersion"("createdByUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "DesignSystem" ADD CONSTRAINT "DesignSystem_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignSystem" ADD CONSTRAINT "DesignSystem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignSystemVersion" ADD CONSTRAINT "DesignSystemVersion_designSystemId_fkey" FOREIGN KEY ("designSystemId") REFERENCES "DesignSystem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignSystemVersion" ADD CONSTRAINT "DesignSystemVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
