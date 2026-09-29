CREATE TABLE "admin_audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(32) NOT NULL,
    "entity_id" UUID NOT NULL,
    "request_id" VARCHAR(128) NOT NULL,
    "before_json" JSONB NOT NULL,
    "after_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "admin_audit_logs_action_check" CHECK ("action" IN (
      'CATEGORY_CREATE', 'CATEGORY_UPDATE', 'CATEGORY_ARCHIVE',
      'PRODUCT_CREATE', 'PRODUCT_UPDATE', 'PRODUCT_PUBLISH', 'PRODUCT_ARCHIVE',
      'PRODUCT_MEDIA_SIGNATURE', 'PRODUCT_MEDIA_REGISTER', 'PRODUCT_MEDIA_UPDATE', 'PRODUCT_MEDIA_REMOVE',
      'PRICE_CREATE', 'INVENTORY_ADJUST',
      'PROMOTION_CREATE', 'PROMOTION_UPDATE', 'PROMOTION_PUBLISH', 'PROMOTION_ARCHIVE',
      'PROMOTION_MEDIA_SIGNATURE', 'PROMOTION_MEDIA_REGISTER', 'PROMOTION_MEDIA_REMOVE'
    )),
    CONSTRAINT "admin_audit_logs_entity_type_check" CHECK ("entity_type" IN (
      'CATEGORY', 'PRODUCT', 'PRODUCT_MEDIA', 'PRICE', 'INVENTORY',
      'PROMOTION', 'PROMOTION_MEDIA'
    ))
);

CREATE INDEX "admin_audit_logs_actor_user_id_created_at_idx"
  ON "admin_audit_logs"("actor_user_id", "created_at" DESC);
CREATE INDEX "admin_audit_logs_entity_type_entity_id_created_at_idx"
  ON "admin_audit_logs"("entity_type", "entity_id", "created_at" DESC);
CREATE INDEX "admin_audit_logs_request_id_idx"
  ON "admin_audit_logs"("request_id");


CREATE FUNCTION prevent_admin_audit_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin audit logs are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admin_audit_logs_append_only
BEFORE UPDATE OR DELETE ON "admin_audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_admin_audit_log_mutation();



