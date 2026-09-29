CREATE TYPE "MediaCleanupStatus" AS ENUM ('PENDING', 'FAILED', 'COMPLETED');

CREATE TABLE "media_cleanup" (
  "id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "product_image_id" UUID NOT NULL,
  "cloudinary_public_id" TEXT NOT NULL,
  "status" "MediaCleanupStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3),
  "last_error_code" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "media_cleanup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_cleanup_attempt_count_check" CHECK ("attempt_count" >= 0 AND "attempt_count" <= 5),
  CONSTRAINT "media_cleanup_completion_check" CHECK (("status" = 'COMPLETED' AND "completed_at" IS NOT NULL) OR ("status" <> 'COMPLETED' AND "completed_at" IS NULL)),
  CONSTRAINT "media_cleanup_failed_check" CHECK ("status" <> 'FAILED' OR "attempt_count" = 5)
);

CREATE UNIQUE INDEX "media_cleanup_product_image_id_key" ON "media_cleanup"("product_image_id");
CREATE UNIQUE INDEX "media_cleanup_cloudinary_public_id_key" ON "media_cleanup"("cloudinary_public_id");
CREATE INDEX "media_cleanup_status_next_attempt_at_idx" ON "media_cleanup"("status", "next_attempt_at");
CREATE INDEX "media_cleanup_product_id_created_at_idx" ON "media_cleanup"("product_id", "created_at");
ALTER TABLE "media_cleanup" ADD CONSTRAINT "media_cleanup_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
