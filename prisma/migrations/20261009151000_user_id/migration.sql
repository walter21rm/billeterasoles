TRUNCATE TABLE movements, outbox, idempotency_records, wallets CASCADE;

DROP INDEX IF EXISTS "wallets_owner_id_key";
ALTER TABLE "wallets" DROP COLUMN "owner_id";
ALTER TABLE "wallets" ADD COLUMN "id_usuario" INTEGER NOT NULL;
CREATE UNIQUE INDEX "wallets_id_usuario_key" ON "wallets"("id_usuario");
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_id_usuario_positive" CHECK ("id_usuario" > 0);
