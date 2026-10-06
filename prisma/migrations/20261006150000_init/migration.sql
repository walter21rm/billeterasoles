-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "movement_direction" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "movement_type" AS ENUM ('TOP_UP', 'PAYMENT', 'TRANSFER_OUT', 'TRANSFER_IN', 'REVERSAL');

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PEN',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movements" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PEN',
    "direction" "movement_direction" NOT NULL,
    "type" "movement_type" NOT NULL,
    "counterparty_wallet_id" UUID,
    "transfer_id" UUID,
    "reversal_of" UUID,
    "idempotency_key" TEXT,
    "external_reference" TEXT,
    "reason" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "outbox" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "published_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallets_owner_id_key" ON "wallets"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "movements_reversal_of_key" ON "movements"("reversal_of");

-- CreateIndex
CREATE UNIQUE INDEX "movements_idempotency_key_key" ON "movements"("idempotency_key");

-- CreateIndex
CREATE INDEX "movements_wallet_created_at_idx" ON "movements"("wallet_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "movements_transfer_id_idx" ON "movements"("transfer_id");

-- AddForeignKey
ALTER TABLE "movements" ADD CONSTRAINT "movements_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wallets" ADD CONSTRAINT "wallets_currency_pen" CHECK (currency = 'PEN');
ALTER TABLE "movements" ADD CONSTRAINT "movements_currency_pen" CHECK (currency = 'PEN');
ALTER TABLE "movements" ADD CONSTRAINT "movements_amount_positive" CHECK (amount > 0);
ALTER TABLE "movements" ADD CONSTRAINT "movements_reason_length" CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 500);

CREATE UNIQUE INDEX "movements_external_reference_unique"
ON "movements" ("wallet_id", "external_reference")
WHERE "external_reference" IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'movements are append-only';
END;
$$;

CREATE TRIGGER movements_no_update
BEFORE UPDATE ON movements
FOR EACH ROW EXECUTE FUNCTION prevent_movement_mutation();

CREATE TRIGGER movements_no_delete
BEFORE DELETE ON movements
FOR EACH ROW EXECUTE FUNCTION prevent_movement_mutation();
