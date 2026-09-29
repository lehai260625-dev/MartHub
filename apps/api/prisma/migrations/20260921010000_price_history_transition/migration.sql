CREATE FUNCTION "enforce_product_price_history_immutability"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."product_id" IS DISTINCT FROM OLD."product_id"
    OR NEW."price" IS DISTINCT FROM OLD."price"
    OR NEW."compare_at_price" IS DISTINCT FROM OLD."compare_at_price"
    OR NEW."starts_at" IS DISTINCT FROM OLD."starts_at"
    OR NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    OR OLD."ends_at" IS NOT NULL
    OR NEW."ends_at" IS NULL
  THEN
    RAISE EXCEPTION 'product price history is immutable outside successor closure'
      USING ERRCODE = '23514', CONSTRAINT = 'product_price_history_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "product_price_history_immutable"
BEFORE UPDATE ON "product_price_history"
FOR EACH ROW
EXECUTE FUNCTION "enforce_product_price_history_immutability"();

CREATE FUNCTION "verify_product_price_history_successor"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "product_price_history" successor
    WHERE successor."product_id" = NEW."product_id"
      AND successor."starts_at" = NEW."ends_at"
  ) THEN
    RAISE EXCEPTION 'closed product price interval requires its direct successor'
      USING ERRCODE = '23514', CONSTRAINT = 'product_price_history_successor_required';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "product_price_history_successor_required"
AFTER UPDATE OF "ends_at" ON "product_price_history"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (OLD."ends_at" IS DISTINCT FROM NEW."ends_at")
EXECUTE FUNCTION "verify_product_price_history_successor"();
