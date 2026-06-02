-- Phase 6 remaining: thumbnail fields on DeckRevision
-- Phase 7: Comments and Tweaks

-- Extend DeckRevisionSource enum with AI-applied sources
ALTER TYPE "DeckRevisionSource" ADD VALUE 'AI_COMMENTS_APPLIED';
ALTER TYPE "DeckRevisionSource" ADD VALUE 'AI_TWEAKS_APPLIED';

-- Add thumbnail storage columns to DeckRevision
ALTER TABLE "DeckRevision" ADD COLUMN "thumbnailGcsBucket" TEXT;
ALTER TABLE "DeckRevision" ADD COLUMN "thumbnailGcsPath" TEXT;

-- New enums
CREATE TYPE "CommentStatus" AS ENUM ('OPEN', 'SUBMITTED', 'APPLIED', 'RESOLVED', 'REJECTED');
CREATE TYPE "TweakScope" AS ENUM ('DECK', 'SLIDE', 'ELEMENT');
CREATE TYPE "TweakBatchStatus" AS ENUM ('PENDING', 'SUBMITTED', 'APPLIED');

-- Comment table
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "slideId" TEXT,
    "elementIds" TEXT[] NOT NULL DEFAULT '{}',
    "text" TEXT NOT NULL,
    "status" "CommentStatus" NOT NULL DEFAULT 'OPEN',
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- TweakBatch table
CREATE TABLE "TweakBatch" (
    "id" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "status" "TweakBatchStatus" NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TweakBatch_pkey" PRIMARY KEY ("id")
);

-- TweakItem table
CREATE TABLE "TweakItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "scope" "TweakScope" NOT NULL,
    "slideId" TEXT,
    "elementId" TEXT,
    "category" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TweakItem_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_deckId_fkey"
    FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TweakBatch" ADD CONSTRAINT "TweakBatch_deckId_fkey"
    FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TweakItem" ADD CONSTRAINT "TweakItem_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "TweakBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "Comment_deckId_status_createdAt_idx" ON "Comment"("deckId", "status", "createdAt");
CREATE INDEX "Comment_authorId_createdAt_idx" ON "Comment"("authorId", "createdAt");
CREATE INDEX "TweakBatch_deckId_status_createdAt_idx" ON "TweakBatch"("deckId", "status", "createdAt");
CREATE INDEX "TweakItem_batchId_category_idx" ON "TweakItem"("batchId", "category");
