-- Add ExportFormat enum and ExportedFile.format column so PDF exports can live
-- alongside PPTX exports in the same table. Existing rows backfill to PPTX.

CREATE TYPE "ExportFormat" AS ENUM ('PPTX', 'PDF');

ALTER TABLE "ExportedFile"
  ADD COLUMN "format" "ExportFormat" NOT NULL DEFAULT 'PPTX';
