CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE "CategoryStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "PromotionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "PromotionPlacement" AS ENUM ('HERO_PRIMARY', 'HERO_SECONDARY', 'EDITORIAL');

CREATE TABLE "categories" (
  "id" UUID NOT NULL,
  "parent_id" UUID,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "image_public_id" TEXT,
  "image_url" TEXT,
  "status" "CategoryStatus" NOT NULL DEFAULT 'ACTIVE',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "archived_at" TIMESTAMPTZ(3),
  CONSTRAINT "categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "categories_slug_check" CHECK ("slug" <> '' AND "slug" = lower(btrim("slug")) AND "slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT "categories_not_own_parent_check" CHECK ("parent_id" IS NULL OR "parent_id" <> "id"),
  CONSTRAINT "categories_archive_check" CHECK ("status" <> 'ARCHIVED' OR "archived_at" IS NOT NULL)
);
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");
CREATE INDEX "categories_parent_id_status_sort_order_idx" ON "categories"("parent_id", "status", "sort_order");
CREATE INDEX "categories_status_sort_order_idx" ON "categories"("status", "sort_order");
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "products" (
  "id" UUID NOT NULL,
  "category_id" UUID NOT NULL,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "short_description" TEXT,
  "description" TEXT,
  "brand" TEXT,
  "selling_unit" TEXT NOT NULL,
  "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
  "is_featured" BOOLEAN NOT NULL DEFAULT false,
  "is_new" BOOLEAN NOT NULL DEFAULT false,
  "is_popular" BOOLEAN NOT NULL DEFAULT false,
  "published_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "archived_at" TIMESTAMPTZ(3),
  CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "products_slug_check" CHECK ("slug" <> '' AND "slug" = lower(btrim("slug")) AND "slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT "products_sku_check" CHECK ("sku" <> '' AND "sku" = btrim("sku")),
  CONSTRAINT "products_archive_check" CHECK ("status" <> 'ARCHIVED' OR "archived_at" IS NOT NULL)
);
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");
CREATE INDEX "products_category_id_status_created_at_idx" ON "products"("category_id", "status", "created_at");
CREATE INDEX "products_status_is_featured_idx" ON "products"("status", "is_featured");
CREATE INDEX "products_status_is_new_published_at_idx" ON "products"("status", "is_new", "published_at");
CREATE INDEX "products_status_is_popular_idx" ON "products"("status", "is_popular");
CREATE INDEX "products_status_created_at_idx" ON "products"("status", "created_at");
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "product_images" (
  "id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "cloudinary_public_id" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "alt_text" TEXT NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "product_images_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_images_dimensions_check" CHECK ("width" > 0 AND "height" > 0)
);
CREATE UNIQUE INDEX "product_images_cloudinary_public_id_key" ON "product_images"("cloudinary_public_id");
CREATE UNIQUE INDEX "product_images_product_id_sort_order_key" ON "product_images"("product_id", "sort_order");
CREATE UNIQUE INDEX "product_images_one_primary_per_product" ON "product_images"("product_id") WHERE "is_primary" = true;
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "product_price_history" (
  "id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "price" BIGINT NOT NULL,
  "compare_at_price" BIGINT,
  "starts_at" TIMESTAMPTZ(3) NOT NULL,
  "ends_at" TIMESTAMPTZ(3),
  "created_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_price_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_price_positive_check" CHECK ("price" > 0),
  CONSTRAINT "product_compare_price_check" CHECK ("compare_at_price" IS NULL OR "compare_at_price" > "price"),
  CONSTRAINT "product_price_interval_check" CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at")
);
CREATE INDEX "product_price_history_product_id_starts_at_idx" ON "product_price_history"("product_id", "starts_at" DESC);
CREATE INDEX "product_price_history_product_id_ends_at_idx" ON "product_price_history"("product_id", "ends_at");
ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_no_overlap" EXCLUDE USING gist ("product_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&);

CREATE TABLE "inventory" (
  "id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "quantity_on_hand" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "inventory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_nonnegative_check" CHECK ("quantity_on_hand" >= 0)
);
CREATE UNIQUE INDEX "inventory_product_id_key" ON "inventory"("product_id");
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "promotions" (
  "id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "subtitle" TEXT,
  "image_public_id" TEXT,
  "image_url" TEXT,
  "internal_href" TEXT NOT NULL,
  "placement" "PromotionPlacement" NOT NULL,
  "status" "PromotionStatus" NOT NULL DEFAULT 'DRAFT',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "starts_at" TIMESTAMPTZ(3) NOT NULL,
  "ends_at" TIMESTAMPTZ(3),
  "created_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "archived_at" TIMESTAMPTZ(3),
  CONSTRAINT "promotions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "promotions_schedule_check" CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at"),
  CONSTRAINT "promotions_archive_check" CHECK ("status" <> 'ARCHIVED' OR "archived_at" IS NOT NULL),
  CONSTRAINT "promotions_internal_href_check" CHECK ("internal_href" LIKE '/%' AND "internal_href" NOT LIKE '//%' AND "internal_href" !~ '[[:cntrl:]]')
);
CREATE UNIQUE INDEX "promotions_image_public_id_key" ON "promotions"("image_public_id");
CREATE INDEX "promotions_placement_status_starts_at_ends_at_idx" ON "promotions"("placement", "status", "starts_at", "ends_at");
CREATE INDEX "promotions_status_sort_order_idx" ON "promotions"("status", "sort_order");
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
