CREATE TYPE "ImageProviderKind" AS ENUM (
  'IMAGEN',
  'GEMINI_IMAGE',
  'GPT_IMAGE_2',
  'OPENAI_COMPATIBLE'
);

CREATE TABLE "GlobalImageGenerationSettings" (
  "id" TEXT NOT NULL,
  "isEnabled" BOOLEAN NOT NULL DEFAULT false,
  "defaultProviderKind" "ImageProviderKind",
  "defaultModel" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GlobalImageGenerationSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceImageGenerationSettings" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "isEnabled" BOOLEAN,
  "preferredProviderKind" "ImageProviderKind",
  "preferredModel" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkspaceImageGenerationSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceImageGenerationSettings_workspaceId_key"
ON "WorkspaceImageGenerationSettings"("workspaceId");

CREATE INDEX "WorkspaceImageGenerationSettings_createdAt_idx"
ON "WorkspaceImageGenerationSettings"("createdAt");

ALTER TABLE "WorkspaceImageGenerationSettings"
ADD CONSTRAINT "WorkspaceImageGenerationSettings_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;