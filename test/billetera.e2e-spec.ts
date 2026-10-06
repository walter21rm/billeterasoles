import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://billetera:billetera@localhost:5432/billetera';

describe('Billetera en soles', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const token = sign({ sub: 'canal-caja' }, process.env.JWT_SECRET ?? 'dev-only-change-me', {
    algorithm: 'HS256',
    issuer: process.env.JWT_ISSUER ?? 'billetera-dev',
  });

  beforeAll(async () => {
    process.env.PORT ??= '3000';
    process.env.DATABASE_URL ??= databaseUrl;
    process.env.JWT_SECRET ??= 'dev-only-change-me';
    process.env.JWT_ISSUER ??= 'billetera-dev';
    process.env.LOG_LEVEL ??= 'info';
    execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE movements, outbox, idempotency_records, wallets CASCADE',
    );
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('abre la billetera una sola vez por titular y repite la misma respuesta', async () => {
    const ownerId = randomUUID();
    const created = await request(app.getHttpServer())
      .post('/v1/wallets')
      .set(auth())
      .set('Idempotency-Key', 'abrir-1')
      .send({ ownerId });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ ownerId, currency: 'PEN', balance: 0 });

    const replay = await request(app.getHttpServer())
      .post('/v1/wallets')
      .set(auth())
      .set('Idempotency-Key', 'abrir-1')
      .send({ ownerId });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(created.body.id);

    const duplicated = await request(app.getHttpServer())
      .post('/v1/wallets')
      .set(auth())
      .set('Idempotency-Key', 'abrir-2')
      .send({ ownerId });
    expect(duplicated.status).toBe(409);
  });

  it('suma una recarga, rechaza un débito sin fondos y conserva el saldo', async () => {
    const walletId = await openWallet();
    const topped = await request(app.getHttpServer())
      .post(`/v1/wallets/${walletId}/top-ups`)
      .set(auth())
      .set('Idempotency-Key', 'recarga-1')
      .send({ amount: 1500, externalReference: 'REC-1' });
    expect(topped.status).toBe(201);
    expect(topped.body).toMatchObject({ amount: 1500, currency: 'PEN', direction: 'CREDIT', type: 'TOP_UP' });

    const replay = await request(app.getHttpServer())
      .post(`/v1/wallets/${walletId}/top-ups`)
      .set(auth())
      .set('Idempotency-Key', 'recarga-1')
      .send({ amount: 1500, externalReference: 'REC-1' });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(topped.body.id);

    const rejected = await request(app.getHttpServer())
      .post(`/v1/wallets/${walletId}/payments`)
      .set(auth())
      .set('Idempotency-Key', 'pago-grande')
      .send({ amount: 1501 });
    expect(rejected.status).toBe(422);

    const conflict = await request(app.getHttpServer())
      .post(`/v1/wallets/${walletId}/top-ups`)
      .set(auth())
      .set('Idempotency-Key', 'recarga-1')
      .send({ amount: 100 });
    expect(conflict.status).toBe(409);

    expect(await balanceOf(walletId)).toBe(1500);
    expect(await summedMovements(walletId)).toBe(1500);
    expect(await prisma.outbox.count({ where: { type: 'wallet.credited' } })).toBe(1);
  });

  it('transfiere entre dos billeteras o no mueve ninguna', async () => {
    const source = await openWallet();
    const target = await openWallet();
    await topUp(source, 1000, 'fondeo');

    const failed = await request(app.getHttpServer())
      .post('/v1/transfers')
      .set(auth())
      .set('Idempotency-Key', 'trx-falla')
      .send({ sourceWalletId: source, targetWalletId: target, amount: 1001 });
    expect(failed.status).toBe(422);
    expect(await balanceOf(source)).toBe(1000);
    expect(await balanceOf(target)).toBe(0);
    expect(await prisma.movement.count({ where: { type: { in: ['TRANSFER_OUT', 'TRANSFER_IN'] } } })).toBe(0);

    const moved = await request(app.getHttpServer())
      .post('/v1/transfers')
      .set(auth())
      .set('Idempotency-Key', 'trx-ok')
      .send({ sourceWalletId: source, targetWalletId: target, amount: 400 });
    expect(moved.status).toBe(201);
    expect(moved.body.movements).toHaveLength(2);
    expect(await balanceOf(source)).toBe(600);
    expect(await balanceOf(target)).toBe(400);
    expect(await summedMovements(source)).toBe(600);
    expect(await summedMovements(target)).toBe(400);
  });

  it('reversa una sola vez y no reversa una transferencia si el destino ya gastó el dinero', async () => {
    const source = await openWallet();
    const target = await openWallet();
    const credit = await topUp(source, 1000, 'base');
    const reversal = await request(app.getHttpServer())
      .post(`/v1/movements/${credit}/reverse`)
      .set(auth())
      .set('Idempotency-Key', 'reverso-1')
      .send({ reason: 'error de caja' });
    expect(reversal.status).toBe(201);
    expect(await balanceOf(source)).toBe(0);

    const again = await request(app.getHttpServer())
      .post(`/v1/movements/${credit}/reverse`)
      .set(auth())
      .set('Idempotency-Key', 'reverso-2')
      .send({ reason: 'segundo intento' });
    expect(again.status).toBe(422);

    await topUp(source, 1000, 'base-2');
    const transfer = await request(app.getHttpServer())
      .post('/v1/transfers')
      .set(auth())
      .set('Idempotency-Key', 'trx-reverso')
      .send({ sourceWalletId: source, targetWalletId: target, amount: 1000 });
    await request(app.getHttpServer())
      .post(`/v1/wallets/${target}/payments`)
      .set(auth())
      .set('Idempotency-Key', 'gasto-destino')
      .send({ amount: 1000 })
      .expect(201);

    const blocked = await request(app.getHttpServer())
      .post(`/v1/movements/${transfer.body.movements[0].id}/reverse`)
      .set(auth())
      .set('Idempotency-Key', 'reverso-trx')
      .send({ reason: 'el destino ya gastó' });
    expect(blocked.status).toBe(422);
    expect(await balanceOf(source)).toBe(0);
    expect(await balanceOf(target)).toBe(0);
  });

  it('exige token y responde listo cuando Postgres está arriba', async () => {
    const denied = await request(app.getHttpServer()).post('/v1/wallets').send({ ownerId: randomUUID() });
    expect(denied.status).toBe(401);
    expect(denied.body.status).toBe(401);

    const health = await request(app.getHttpServer()).get('/health');
    expect(health.status).toBe(200);
    const ready = await request(app.getHttpServer()).get('/health/ready');
    expect(ready.status).toBe(200);
  });

  function auth(): { Authorization: string } {
    return { Authorization: `Bearer ${token}` };
  }

  async function openWallet(): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/v1/wallets')
      .set(auth())
      .set('Idempotency-Key', randomUUID())
      .send({ ownerId: randomUUID() });
    expect(response.status).toBe(201);
    return response.body.id as string;
  }

  async function topUp(walletId: string, amount: number, key: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post(`/v1/wallets/${walletId}/top-ups`)
      .set(auth())
      .set('Idempotency-Key', key)
      .send({ amount });
    expect(response.status).toBe(201);
    return response.body.id as string;
  }

  async function balanceOf(walletId: string): Promise<number> {
    const response = await request(app.getHttpServer()).get(`/v1/wallets/${walletId}`).set(auth());
    expect(response.status).toBe(200);
    return response.body.balance as number;
  }

  async function summedMovements(walletId: string): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ balance: number }>>`
      SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END), 0)::int AS balance
      FROM movements
      WHERE wallet_id = ${walletId}::uuid
    `;
    return Number(rows[0]?.balance ?? 0);
  }
});
