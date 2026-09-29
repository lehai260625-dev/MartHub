CREATE TYPE "InventoryMovementType" AS ENUM ('INITIAL', 'ADJUSTMENT', 'ORDER_DEBIT', 'ORDER_CANCEL_RESTORE');

CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "type" "InventoryMovementType" NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "quantity_after" INTEGER NOT NULL,
    "order_id" UUID,
    "actor_user_id" UUID,
    "reason" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_movements_quantity_after_check" CHECK ("quantity_after" >= 0),
    CONSTRAINT "inventory_movements_quantity_before_check" CHECK (("quantity_after"::bigint - "quantity_delta"::bigint) >= 0),
    CONSTRAINT "inventory_movements_delta_check" CHECK ("quantity_delta" <> 0 OR "type" = 'INITIAL'),
    CONSTRAINT "inventory_movements_adjustment_audit_check" CHECK (
      "type" <> 'ADJUSTMENT' OR (
        "actor_user_id" IS NOT NULL
        AND "reason" IS NOT NULL
        AND length(btrim("reason")) BETWEEN 1 AND 240
        AND "order_id" IS NULL
      )
    ),
    CONSTRAINT "inventory_movements_order_check" CHECK (
      "type" NOT IN ('ORDER_DEBIT', 'ORDER_CANCEL_RESTORE') OR "order_id" IS NOT NULL
    )
);

CREATE INDEX "inventory_quantity_on_hand_idx" ON "inventory"("quantity_on_hand");
CREATE INDEX "inventory_movements_product_id_created_at_idx" ON "inventory_movements"("product_id", "created_at" DESC);
CREATE INDEX "inventory_movements_order_id_type_idx" ON "inventory_movements"("order_id", "type");
CREATE UNIQUE INDEX "inventory_movements_order_product_type_key"
  ON "inventory_movements"("order_id", "product_id", "type")
  WHERE "order_id" IS NOT NULL;

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE FUNCTION prevent_inventory_movement_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'inventory movements are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inventory_movements_append_only
BEFORE UPDATE OR DELETE ON "inventory_movements"
FOR EACH ROW EXECUTE FUNCTION prevent_inventory_movement_mutation();

