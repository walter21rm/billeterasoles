import { Injectable } from '@nestjs/common';
import { MovementDirection, MovementType, Prisma } from '@prisma/client';
import { ConflictError, IdempotencyRaceError, NotFoundError, UnprocessableError } from '../domain/errors';
import {
  IdempotencyRow,
  MovementListQuery,
  MovementRow,
  MovementTypeName,
  NewMovement,
  OutboxEvent,
  WalletRow,
} from '../application/types';
import { StoreTx, WalletStore } from '../application/store';
import { OutboxRepository } from '../outbox/outbox.repository';
import { PrismaService } from './prisma.service';

type TxClient = Prisma.TransactionClient;

@Injectable()
export class PrismaWalletStore extends WalletStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxRepository,
  ) {
    super();
  }

  async transaction<T>(work: (tx: StoreTx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(async (tx) => work(new PrismaStoreTx(tx, this.outbox)));
    } catch (error) {
      throw translatePrisma(error);
    }
  }

  findIdempotency(key: string): Promise<IdempotencyRow | null> {
    return this.prisma.idempotencyRecord
      .findUnique({ where: { key } })
      .then((row) => (row ? toIdempotency(row) : null));
  }

  async findWallet(id: string): Promise<WalletRow | null> {
    const row = await this.prisma.wallet.findUnique({ where: { id } });
    return row ? toWallet(row) : null;
  }

  async findByUserId(userId: number): Promise<WalletRow | null> {
    const row = await this.prisma.wallet.findUnique({ where: { userId } });
    return row ? toWallet(row) : null;
  }

  async walletIdsForMovement(movementId: string): Promise<string[] | null> {
    const movement = await this.prisma.movement.findUnique({ where: { id: movementId } });
    if (!movement) return null;
    if (!movement.transferId) return [movement.walletId];
    const legs = await this.prisma.movement.findMany({
      where: { transferId: movement.transferId },
      select: { walletId: true },
    });
    return legs.map((leg) => leg.walletId);
  }

  balance(walletId: string): Promise<number> {
    return readBalance(this.prisma, walletId);
  }

  async walletExists(id: string): Promise<boolean> {
    const row = await this.prisma.wallet.findUnique({ where: { id }, select: { id: true } });
    return row !== null;
  }

  async listMovements(query: MovementListQuery): Promise<MovementRow[]> {
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) {
      createdAt.gte = query.from;
    }
    if (query.to) {
      createdAt.lte = query.to;
    }
    const rows = await this.prisma.movement.findMany({
      where: {
        walletId: query.walletId,
        ...(query.from || query.to ? { createdAt } : {}),
        ...(query.cursor
          ? {
              OR: [
                { createdAt: { lt: query.cursor.createdAt } },
                { createdAt: query.cursor.createdAt, id: { lt: query.cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
    });
    return rows.map(toMovement);
  }
}

class PrismaStoreTx implements StoreTx {
  constructor(
    private readonly tx: TxClient,
    private readonly outbox: OutboxRepository,
  ) {}

  async lockIdempotency(key: string): Promise<IdempotencyRow | null> {
    const rows = await this.tx.$queryRaw<IdempotencyRow[]>`
      SELECT key,
             request_hash AS "requestHash",
             status_code AS "statusCode",
             response_body AS "responseBody"
      FROM idempotency_records
      WHERE key = ${key}
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  async saveIdempotency(row: IdempotencyRow): Promise<void> {
    await this.tx.idempotencyRecord.create({
      data: {
        key: row.key,
        requestHash: row.requestHash,
        statusCode: row.statusCode,
        responseBody: row.responseBody as Prisma.InputJsonValue,
      },
    });
  }

  async findByUserId(userId: number): Promise<WalletRow | null> {
    const row = await this.tx.wallet.findUnique({ where: { userId } });
    return row ? toWallet(row) : null;
  }

  async createWallet(userId: number): Promise<WalletRow> {
    const row = await this.tx.wallet.create({ data: { userId, currency: 'PEN' } });
    return toWallet(row);
  }

  async lockWallets(ids: string[]): Promise<void> {
    const ordered = [...new Set(ids)].sort();
    for (const id of ordered) {
      const rows = await this.tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM wallets WHERE id = ${id}::uuid FOR UPDATE
      `;
      if (rows.length === 0) {
        throw new NotFoundError('Billetera no encontrada');
      }
    }
  }

  balance(walletId: string): Promise<number> {
    return readBalance(this.tx, walletId);
  }

  async createMovement(input: NewMovement): Promise<MovementRow> {
    const row = await this.tx.movement.create({
      data: {
        walletId: input.walletId,
        amount: input.amount,
        currency: 'PEN',
        direction: input.direction as MovementDirection,
        type: input.type as MovementType,
        counterpartyWalletId: input.counterpartyWalletId,
        transferId: input.transferId,
        reversalOf: input.reversalOf,
        idempotencyKey: input.idempotencyKey,
        externalReference: input.externalReference,
        reason: input.reason,
        createdBy: input.createdBy,
      },
    });
    return toMovement(row);
  }

  async findMovement(id: string): Promise<MovementRow | null> {
    const row = await this.tx.movement.findUnique({ where: { id } });
    return row ? toMovement(row) : null;
  }

  async movementsByTransfer(transferId: string): Promise<MovementRow[]> {
    const rows = await this.tx.movement.findMany({
      where: { transferId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toMovement);
  }

  async reversalOf(movementId: string): Promise<MovementRow | null> {
    const row = await this.tx.movement.findUnique({ where: { reversalOf: movementId } });
    return row ? toMovement(row) : null;
  }

  addOutbox(event: OutboxEvent): Promise<void> {
    return this.outbox.append(this.tx, event);
  }
}

async function readBalance(client: TxClient | PrismaService, walletId: string): Promise<number> {
  const rows = await client.$queryRaw<Array<{ balance: number | bigint | null }>>`
    SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END), 0)::int AS balance
    FROM movements
    WHERE wallet_id = ${walletId}::uuid
  `;
  return Number(rows[0]?.balance ?? 0);
}

function toWallet(row: { id: string; userId: number; currency: string; createdAt: Date }): WalletRow {
  return {
    id: row.id,
    userId: row.userId,
    currency: 'PEN',
    createdAt: row.createdAt,
  };
}

function toMovement(row: {
  id: string;
  walletId: string;
  amount: number;
  direction: MovementDirection;
  type: MovementType;
  counterpartyWalletId: string | null;
  transferId: string | null;
  reversalOf: string | null;
  idempotencyKey: string | null;
  externalReference: string | null;
  reason: string | null;
  createdBy: string;
  createdAt: Date;
}): MovementRow {
  return {
    id: row.id,
    walletId: row.walletId,
    amount: row.amount,
    currency: 'PEN',
    direction: row.direction,
    type: row.type as MovementTypeName,
    counterpartyWalletId: row.counterpartyWalletId,
    transferId: row.transferId,
    reversalOf: row.reversalOf,
    idempotencyKey: row.idempotencyKey,
    externalReference: row.externalReference,
    reason: row.reason,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

function toIdempotency(row: {
  key: string;
  requestHash: string;
  statusCode: number;
  responseBody: Prisma.JsonValue;
}): IdempotencyRow {
  return {
    key: row.key,
    requestHash: row.requestHash,
    statusCode: row.statusCode,
    responseBody: row.responseBody,
  };
}

function translatePrisma(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = `${JSON.stringify(error.meta?.target ?? '')} ${error.message}`;
    if (target.includes('reversal')) {
      return new UnprocessableError('El movimiento ya fue reversado');
    }
    if (target.includes('owner')) {
      return new ConflictError('El titular ya tiene una billetera');
    }
    if (target.includes('external')) {
      return new ConflictError('La referencia externa ya existe en esta billetera');
    }
    if (target.includes('idempotency') || target.includes('key')) {
      return new IdempotencyRaceError();
    }
    return new ConflictError('Conflicto de unicidad');
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
    return new ConflictError('La operación perdió el conflicto de concurrencia');
  }
  if (error instanceof Error && /deadlock detected/i.test(error.message)) {
    return new ConflictError('La operación perdió el conflicto de concurrencia');
  }
  return error;
}
