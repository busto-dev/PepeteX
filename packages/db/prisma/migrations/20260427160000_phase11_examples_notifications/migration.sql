-- Phase 11: PromptExample + Notification models + GeneratedImage.friendlyError

-- Add friendlyError column to GeneratedImage
ALTER TABLE "GeneratedImage" ADD COLUMN "friendlyError" TEXT;

-- PromptExample table
CREATE TABLE "PromptExample" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "promptEn" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "thumbnailGcsBucket" TEXT,
    "thumbnailGcsPath" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptExample_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PromptExample_category_isEnabled_sortOrder_idx" ON "PromptExample"("category", "isEnabled", "sortOrder");
CREATE INDEX "PromptExample_isEnabled_sortOrder_idx" ON "PromptExample"("isEnabled", "sortOrder");

-- Notification table
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "actionUrl" TEXT,
    "metadata" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
