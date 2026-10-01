CREATE TYPE "OrderStatus" AS ENUM (
  'PENDING',
  'CONFIRMED',
  'PACKING',
  'SHIPPING',
  'DELIVERED',
  'CANCELLED'
);

CREATE TABLE "orders" (
  "id" UUID NOT NULL,
  "order_number" TEXT NOT NULL,
  "user_id" UUID NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
  "payment_method" VARCHAR(3) NOT NULL DEFAULT 'COD',
  "currency" VARCHAR(3) NOT NULL DEFAULT 'VND',
  "subtotal" BIGINT NOT NULL,
  "shipping_fee" BIGINT NOT NULL,
  "discount_total" BIGINT NOT NULL DEFAULT 0,
  "total" BIGINT NOT NULL,
  "recipient_name" TEXT NOT NULL,
  "recipient_phone" TEXT NOT NULL,
  "address_line_1" TEXT NOT NULL,
  "address_line_2" TEXT,
  "ward" TEXT NOT NULL,
  "district" TEXT NOT NULL,
  "province" TEXT NOT NULL,
  "postal_code" TEXT,
  "customer_note" TEXT,
  "cancellation_reason" TEXT,
  "idempotency_key" UUID NOT NULL,
  "request_fingerprint" TEXT NOT NULL,
  "placed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelled_at" TIMESTAMPTZ(3),
  "delivered_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "orders_payment_method_check" CHECK ("payment_method" = 'COD'),
  CONSTRAINT "orders_currency_check" CHECK ("currency" = 'VND'),
  CONSTRAINT "orders_money_nonnegative_check" CHECK (
    "subtotal" >= 0
    AND "shipping_fee" >= 0
    AND "discount_total" >= 0
    AND "total" >= 0
  ),
  CONSTRAINT "orders_total_check" CHECK (
    "subtotal" + "shipping_fee" - "discount_total" = "total"
  ),
  CONSTRAINT "orders_order_number_check" CHECK (length(btrim("order_number")) > 0),
  CONSTRAINT "orders_request_fingerprint_check" CHECK (length(btrim("request_fingerprint")) > 0)
);

CREATE TABLE "order_items" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "sku" TEXT NOT NULL,
  "product_name" TEXT NOT NULL,
  "image_url" TEXT,
  "selling_unit" TEXT NOT NULL,
  "unit_price" BIGINT NOT NULL,
  "compare_at_price" BIGINT,
  "quantity" INTEGER NOT NULL,
  "line_total" BIGINT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "order_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_items_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "order_items_price_check" CHECK (
    "unit_price" >= 0
    AND ("compare_at_price" IS NULL OR "compare_at_price" > "unit_price")
  ),
  CONSTRAINT "order_items_line_total_check" CHECK (
    "unit_price" * "quantity"::bigint = "line_total"
  )
);

CREATE TABLE "order_status_history" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "from_status" "OrderStatus",
  "to_status" "OrderStatus" NOT NULL,
  "actor_user_id" UUID,
  "reason" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_status_history_transition_check" CHECK (
    "from_status" IS NULL OR "from_status" <> "to_status"
  )
);

CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");
CREATE UNIQUE INDEX "orders_user_id_idempotency_key_key" ON "orders"("user_id", "idempotency_key");
CREATE INDEX "orders_user_id_created_at_idx" ON "orders"("user_id", "created_at" DESC);
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");
CREATE INDEX "orders_delivered_at_idx" ON "orders"("delivered_at");
CREATE UNIQUE INDEX "order_items_order_id_product_id_key" ON "order_items"("order_id", "product_id");
CREATE INDEX "order_items_product_id_created_at_idx" ON "order_items"("product_id", "created_at" DESC);
CREATE INDEX "order_status_history_order_id_created_at_idx" ON "order_status_history"("order_id", "created_at");
CREATE INDEX "order_status_history_actor_user_id_created_at_idx" ON "order_status_history"("actor_user_id", "created_at" DESC);

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_status_history"
  ADD CONSTRAINT "order_status_history_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_status_history"
  ADD CONSTRAINT "order_status_history_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_order_snapshot_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'orders cannot be deleted';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."order_number" IS DISTINCT FROM OLD."order_number"
    OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
    OR NEW."payment_method" IS DISTINCT FROM OLD."payment_method"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."subtotal" IS DISTINCT FROM OLD."subtotal"
    OR NEW."shipping_fee" IS DISTINCT FROM OLD."shipping_fee"
    OR NEW."discount_total" IS DISTINCT FROM OLD."discount_total"
    OR NEW."total" IS DISTINCT FROM OLD."total"
    OR NEW."recipient_name" IS DISTINCT FROM OLD."recipient_name"
    OR NEW."recipient_phone" IS DISTINCT FROM OLD."recipient_phone"
    OR NEW."address_line_1" IS DISTINCT FROM OLD."address_line_1"
    OR NEW."address_line_2" IS DISTINCT FROM OLD."address_line_2"
    OR NEW."ward" IS DISTINCT FROM OLD."ward"
    OR NEW."district" IS DISTINCT FROM OLD."district"
    OR NEW."province" IS DISTINCT FROM OLD."province"
    OR NEW."postal_code" IS DISTINCT FROM OLD."postal_code"
    OR NEW."customer_note" IS DISTINCT FROM OLD."customer_note"
    OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
    OR NEW."request_fingerprint" IS DISTINCT FROM OLD."request_fingerprint"
    OR NEW."placed_at" IS DISTINCT FROM OLD."placed_at"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'order snapshots are immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_immutable_snapshots
BEFORE UPDATE OR DELETE ON "orders"
FOR EACH ROW EXECUTE FUNCTION prevent_order_snapshot_mutation();

CREATE FUNCTION prevent_order_item_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'order items are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER order_items_append_only
BEFORE UPDATE OR DELETE ON "order_items"
FOR EACH ROW EXECUTE FUNCTION prevent_order_item_mutation();

CREATE FUNCTION prevent_order_status_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'order status history is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER order_status_history_append_only
BEFORE UPDATE OR DELETE ON "order_status_history"
FOR EACH ROW EXECUTE FUNCTION prevent_order_status_history_mutation();
