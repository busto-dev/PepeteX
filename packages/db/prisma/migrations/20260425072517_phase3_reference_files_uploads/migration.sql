-- CreateTable
CREATE TABLE "Deck" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceFile" (
    "id" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "pageCount" INTEGER,
    "imageWidth" INTEGER,
    "imageHeight" INTEGER,
    "storageBucket" TEXT NOT NULL,
    "storageObjectPath" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferenceFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Deck_workspaceId_createdAt_idx" ON "Deck"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Deck_createdByUserId_createdAt_idx" ON "Deck"("createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ReferenceFile_deckId_createdAt_idx" ON "ReferenceFile"("deckId", "createdAt");

-- CreateIndex
CREATE INDEX "ReferenceFile_uploadedByUserId_createdAt_idx" ON "ReferenceFile"("uploadedByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ReferenceFile_expiresAt_idx" ON "ReferenceFile"("expiresAt");

-- AddForeignKey
ALTER TABLE "Deck" ADD CONSTRAINT "Deck_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deck" ADD CONSTRAINT "Deck_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceFile" ADD CONSTRAINT "ReferenceFile_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceFile" ADD CONSTRAINT "ReferenceFile_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
