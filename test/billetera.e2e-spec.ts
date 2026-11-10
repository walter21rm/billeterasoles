import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { sign, verify } from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://billetera:billetera@localhost:5432/billetera';

describe('Billetera en soles', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let users: Server;
  const inactiveUsers = new Set<number>();
  const missingUsers = new Set<number>();
  let usersMode: 'ok' | 'mismatch' | 'down' | 'hang' = 'ok';
  let lastAuthorization = '';
  let nextUser = 10;
  const token = sign({ sub: 'canal-caja' }, process.env.JWT_SECRET ?? 'dev-only-change-me', {
    algorithm: 'HS256',
    issuer: process.env.JWT_ISSUER ?? 'billetera-dev',
  });

  beforeAll(async () => {
    users = createServer((req, res) => {
      lastAuthorization = String(req.headers.authorization ?? '');
      if (usersMode === 'hang') return;
      if (usersMode === 'down') {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      const id = Number(req.url?.split('/').pop());
      if (missingUsers.has(id)) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ detail: 'no existe' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          idUsuario: usersMode === 'mismatch' ? id + 1 : id,
          estado: !inactiveUsers.has(id),
          idRol: 1,
        }),
      );
    });
    await new Promise<void>((resolve) => users.listen(0, '127.0.0.1', () => resolve()));
    const address = users.address() as AddressInfo;
    process.env.PORT ??= '3000';
    process.env.DATABASE_URL ??= databaseUrl;
    process.env.JWT_SECRET ??= 'dev-only-change-me';
    process.env.JWT_ISSUER ??= 'billetera-dev';
    process.env.LOG_LEVEL ??= 'info';
    process.env.USERS_SERVICE_URL = `http://127.0.0.1:${address.port}`;
    execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  beforeEach(async () => {
    usersMode = 'ok';
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE movements, outbox, idempotency_records, wallets CASCADE',
    );
  });

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
    if (users) {
      await new Promise<void>((resolve, reject) => users.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('abre la billetera una sola vez por titular y repite la misma respuesta', async () => {
    const idUsuario = nextUser++;
    const created = await request(app.getHttpServer())
      .post('/v1/wallets')
      .set(auth())
      .set('Idempotency-Key', 'abrir-1')
      .send({ idUsuario });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ idUsuario, currency: 'PEN', balance: 0 });

    const replay = await request(app.getHttpServer())
      .post('/v1/wallets')
      .set(auth())
      .set('Idempotency-Key', 'abrir-1')
      .send({ idUsuario });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(created.body.id);

    const duplicated = await request(app.getHttpServer())
      .post('/v1/wallets')
      .set(auth())
      .set('Idempotency-Key', 'abrir-2')
      .send({ idUsuario });
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

  it('no abre billetera si el usuario no existe o está inactivo', async () => {
    missingUsers.add(4041);
    const missing = await request(app.getHttpServer())
      .post('/v1/wallets')
      .set(auth())
      .set('Idempotency-Key', 'usuario-ausente')
      .send({ idUsuario: 4041 });
    expect(missing.status).toBe(404);
    expect(missing.body.detail).toBe('El usuario no existe');

    inactiveUsers.add(4042);
    const inactive = await request(app.getHttpServer())
      .post('/v1/wallets')
      .set(auth())
      .set('Idempotency-Key', 'usuario-inactivo')
      .send({ idUsuario: 4042 });
    expect(inactive.status).toBe(422);
    expect(inactive.body.detail).toBe('El usuario no está activo');
    expect(await prisma.wallet.count()).toBe(0);
    expect(await prisma.movement.count()).toBe(0);
  });

  it('no escribe si usuarios devuelve otro id, falla o no responde', async () => {
    const secret = process.env.JWT_SECRET ?? 'dev-only-change-me';
    const issuer = process.env.JWT_ISSUER ?? 'billetera-dev';

    usersMode = 'mismatch';
    const mismatch = await request(app.getHttpServer())
      .post('/v1/wallets')
      .set(auth())
      .set('Idempotency-Key', 'usuario-distinto')
      .send({ idUsuario: 8801 });
    expect(mismatch.status).toBe(404);
    expect(verify(lastAuthorization.slice('Bearer '.length), secret, { issuer }).sub).toBe('billetera-service');

    usersMode = 'down';
    const down = await request(app.getHttpServer())
      .post('/v1/wallets')
      .set(auth())
      .set('Idempotency-Key', 'usuarios-caido')
      .send({ idUsuario: 8802 });
    expect(down.status).toBe(503);
    expect(down.body.detail).toBe('El servicio de usuarios no responde');

    usersMode = 'hang';
    const hung = await request(app.getHttpServer())
      .post('/v1/wallets')
      .set(auth())
      .set('Idempotency-Key', 'usuarios-timeout')
      .send({ idUsuario: 8803 });
    expect(hung.status).toBe(503);

    usersMode = 'ok';
    const walletId = await openWallet();
    usersMode = 'down';
    const topUp = await request(app.getHttpServer())
      .post(`/v1/wallets/${walletId}/top-ups`)
      .set(auth())
      .set('Idempotency-Key', 'recarga-sin-usuarios')
      .send({ amount: 1500 });
    expect(topUp.status).toBe(503);
    expect(await balanceOf(walletId)).toBe(0);
    expect(await prisma.movement.count()).toBe(0);
    expect(await prisma.wallet.count()).toBe(1);
  });

  it('descuenta un retiro de 250.00 una sola vez y lo reversa con la clave del acuerdo', async () => {
    const withdrawalId = '14544b68-9c70-4365-bd40-6ba0824bba15';
    const walletId = await openWallet();
    await topUp(walletId, 25000, 'fondeo-retiro');

    const debited = await request(app.getHttpServer())
      .post(`/v1/wallets/${walletId}/payments`)
      .set(auth())
      .set('Idempotency-Key', withdrawalId)
      .send({ amount: 25000, externalReference: withdrawalId });
    expect(debited.status).toBe(201);
    expect(debited.body).toMatchObject({
      amount: 25000,
      direction: 'DEBIT',
      type: 'PAYMENT',
      externalReference: withdrawalId,
    });

    const replay = await request(app.getHttpServer())
      .post(`/v1/wallets/${walletId}/payments`)
      .set(auth())
      .set('Idempotency-Key', withdrawalId)
      .send({ amount: 25000, externalReference: withdrawalId });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(debited.body.id);
    expect(await balanceOf(walletId)).toBe(0);

    const short = await request(app.getHttpServer())
      .post(`/v1/wallets/${walletId}/payments`)
      .set(auth())
      .set('Idempotency-Key', randomUUID())
      .send({ amount: 1000, externalReference: 'otro-retiro' });
    expect(short.status).toBe(422);
    expect(await prisma.movement.count({ where: { type: 'PAYMENT' } })).toBe(1);

    const reversed = await request(app.getHttpServer())
      .post(`/v1/movements/${debited.body.id}/reverse`)
      .set(auth())
      .set('Idempotency-Key', `${withdrawalId}:reverse`)
      .send({ reason: 'retiro anulado' });
    expect(reversed.status).toBe(201);
    expect(reversed.body.movements[0]).toMatchObject({
      amount: 25000,
      direction: 'CREDIT',
      type: 'REVERSAL',
      reversalOf: debited.body.id,
    });
    expect(await balanceOf(walletId)).toBe(25000);

    const second = await request(app.getHttpServer())
      .post(`/v1/movements/${debited.body.id}/reverse`)
      .set(auth())
      .set('Idempotency-Key', `${withdrawalId}:reverse-2`)
      .send({ reason: 'segundo reverso' });
    expect(second.status).toBe(422);
    expect(await balanceOf(walletId)).toBe(25000);
  });

  it('exige token y responde listo cuando Postgres está arriba', async () => {
    const denied = await request(app.getHttpServer()).post('/v1/wallets').send({ idUsuario: nextUser++ });
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
      .send({ idUsuario: nextUser++ });
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
