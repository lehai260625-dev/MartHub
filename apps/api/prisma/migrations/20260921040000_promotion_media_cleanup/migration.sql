CREATE TYPE "MediaOwnerType" AS ENUM ('PRODUCT_IMAGE', 'PROMOTION_MEDIA');

ALTER TABLE "media_cleanup"
  ADD COLUMN "owner_type" "MediaOwnerType" NOT NULL DEFAULT 'PRODUCT_IMAGE',
  ADD COLUMN "promotion_id" UUID,
  ALTER COLUMN "product_id" DROP NOT NULL,
  ALTER COLUMN "product_image_id" DROP NOT NULL;

ALTER TABLE "media_cleanup"
  ADD CONSTRAINT "media_cleanup_owner_check" CHECK (
    ("owner_type" = 'PRODUCT_IMAGE' AND "product_id" IS NOT NULL AND "product_image_id" IS NOT NULL AND "promotion_id" IS NULL)
    OR
    ("owner_type" = 'PROMOTION_MEDIA' AND "product_id" IS NULL AND "product_image_id" IS NULL AND "promotion_id" IS NOT NULL)
  );

ALTER TABLE "media_cleanup"
  ADD CONSTRAINT "media_cleanup_promotion_id_fkey"
  FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "media_cleanup_promotion_id_created_at_idx"
  ON "media_cleanup"("promotion_id", "created_at");
