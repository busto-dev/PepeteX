-- CreateEnum
CREATE TYPE "DeckRevisionSource" AS ENUM (
  'INITIAL',
  'MANUAL_TEXT_EDIT',
  'SLIDE_DUPLICATED',
  'SLIDE_REORDERED',
  'SLIDE_DELETED',
  'REVISION_RESTORED'
);

-- AlterTable
ALTER TABLE "Deck"
ADD COLUMN "contentJson" JSONB,
ADD COLUMN "currentRevisionNumber" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DeckRevision" (
  "id" TEXT NOT NULL,
  "deckId" TEXT NOT NULL,
  "revisionNumber" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "source" "DeckRevisionSource" NOT NULL,
  "summary" TEXT,
  "deckJson" JSONB NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "restoredFromRevisionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DeckRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeckRevision_deckId_revisionNumber_key" ON "DeckRevision"("deckId", "revisionNumber");

-- CreateIndex
CREATE INDEX "DeckRevision_deckId_createdAt_idx" ON "DeckRevision"("deckId", "createdAt");

-- CreateIndex
CREATE INDEX "DeckRevision_createdByUserId_createdAt_idx" ON "DeckRevision"("createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "DeckRevision_restoredFromRevisionId_idx" ON "DeckRevision"("restoredFromRevisionId");

-- AddForeignKey
ALTER TABLE "DeckRevision"
ADD CONSTRAINT "DeckRevision_deckId_fkey"
FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeckRevision"
ADD CONSTRAINT "DeckRevision_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeckRevision"
ADD CONSTRAINT "DeckRevision_restoredFromRevisionId_fkey"
FOREIGN KEY ("restoredFromRevisionId") REFERENCES "DeckRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
