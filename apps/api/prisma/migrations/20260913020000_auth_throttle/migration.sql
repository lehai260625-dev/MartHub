CREATE TABLE "auth_throttles" (
  "key" VARCHAR(64) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "auth_throttles_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "auth_throttles_key_check" CHECK ("key" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "auth_throttles_attempts_check" CHECK ("attempts" >= 0)
);
CREATE INDEX "auth_throttles_expires_at_idx" ON "auth_throttles"("expires_at");
