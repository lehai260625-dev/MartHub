CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "products_active_name_trgm_idx" ON "products" USING GIN ("name" gin_trgm_ops) WHERE "status" = 'ACTIVE' AND "archived_at" IS NULL;
CREATE INDEX "products_active_brand_trgm_idx" ON "products" USING GIN ("brand" gin_trgm_ops) WHERE "status" = 'ACTIVE' AND "archived_at" IS NULL;
CREATE INDEX "products_active_sku_trgm_idx" ON "products" USING GIN ("sku" gin_trgm_ops) WHERE "status" = 'ACTIVE' AND "archived_at" IS NULL;
