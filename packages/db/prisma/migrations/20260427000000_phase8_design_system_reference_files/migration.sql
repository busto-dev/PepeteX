-- CreateTable
CREATE TABLE "DesignSystemReferenceFile" (
    "id" TEXT NOT NULL,
    "designSystemId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "pageCount" INTEGER,
    "imageWidth" INTEGER,
    "imageHeight" INTEGER,
    "storageBucket" TEXT NOT NULL,
    "storageObjectPath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignSystemReferenceFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DesignSystemReferenceFile_designSystemId_createdAt_idx" ON "DesignSystemReferenceFile"("designSystemId", "createdAt");

-- CreateIndex
CREATE INDEX "DesignSystemReferenceFile_uploadedByUserId_createdAt_idx" ON "DesignSystemReferenceFile"("uploadedByUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "DesignSystemReferenceFile" ADD CONSTRAINT "DesignSystemReferenceFile_designSystemId_fkey" FOREIGN KEY ("designSystemId") REFERENCES "DesignSystem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignSystemReferenceFile" ADD CONSTRAINT "DesignSystemReferenceFile_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
