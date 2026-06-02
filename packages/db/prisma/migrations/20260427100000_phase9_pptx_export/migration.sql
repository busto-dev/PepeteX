-- CreateEnum
CREATE TYPE "ExportJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- AlterTable: add export relations to Deck (no column change needed, just FK on child tables)

-- CreateTable: ExportJobToken
CREATE TABLE "ExportJobToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportJobToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ExportedFile
CREATE TABLE "ExportedFile" (
    "id" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "gcsBucket" TEXT NOT NULL,
    "gcsPath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "ExportJobStatus" NOT NULL DEFAULT 'COMPLETED',
    "isFallback" BOOLEAN NOT NULL DEFAULT false,
    "fallbackReason" TEXT,
    "pepetexVersion" TEXT,
    "exportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exportedByUserId" TEXT NOT NULL,
    "jobId" TEXT,

    CONSTRAINT "ExportedFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExportJobToken_token_key" ON "ExportJobToken"("token");
CREATE INDEX "ExportJobToken_token_idx" ON "ExportJobToken"("token");
CREATE INDEX "ExportJobToken_deckId_createdAt_idx" ON "ExportJobToken"("deckId", "createdAt");
CREATE INDEX "ExportJobToken_expiresAt_idx" ON "ExportJobToken"("expiresAt");

CREATE INDEX "ExportedFile_deckId_exportedAt_idx" ON "ExportedFile"("deckId", "exportedAt");
CREATE INDEX "ExportedFile_exportedByUserId_exportedAt_idx" ON "ExportedFile"("exportedByUserId", "exportedAt");

-- AddForeignKey
ALTER TABLE "ExportJobToken" ADD CONSTRAINT "ExportJobToken_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExportJobToken" ADD CONSTRAINT "ExportJobToken_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExportedFile" ADD CONSTRAINT "ExportedFile_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExportedFile" ADD CONSTRAINT "ExportedFile_exportedByUserId_fkey" FOREIGN KEY ("exportedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
