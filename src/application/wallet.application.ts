import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConflictError, IdempotencyRaceError, NotFoundError, UnprocessableError } from '../domain/errors';
import { assertCanDebit, invertedDirection, Money } from '../domain/money';
import { requestHash } from './hash';
import { decodeCursor, encodeCursor, MovementDto, toMovementDto, toWalletDto, WalletDto } from './presenters';
import { StoreTx, WalletStore } from './store';
import { MovementRow } from './types';
import { UserDirectory } from '../users/user-directory';

export interface CommandResult<T> {
  status: number;
  body: T;
}

interface IdempotentCommand {
  idempotencyKey: string;
  body: unknown;
  createdBy: string;
}

@Injectable()
export class WalletApplication {
  constructor(
    private readonly store: WalletStore,
    private readonly users: UserDirectory,
  ) {}

  async open(input: IdempotentCommand & { userId: number }): Promise<CommandResult<WalletDto>> {
    await this.users.requireActive(input.userId);
    return this.idempotent(input.idempotencyKey, input.body, async (tx) => {
      const existing = await tx.findByUserId(input.userId);
      if (existing) {
        throw new ConflictError('El usuario ya tiene una billetera');
      }
      const wallet = await tx.createWallet(input.userId);
      await tx.addOutbox({
        eventId: randomUUID(),
        type: 'wallet.opened',
        occurredAt: new Date().toISOString(),
        walletId: wallet.id,
        idUsuario: wallet.userId,
        amount: 0,
        currency: 'PEN',
      });
      return toWalletDto(wallet, 0);
    });
  }

  async getById(walletId: string): Promise<WalletDto> {
    const wallet = await this.store.findWallet(walletId);
    if (!wallet) {
      throw new NotFoundError('Billetera no encontrada');
    }
    return toWalletDto(wallet, await this.store.balance(walletId));
  }

  async getByOwner(userId: number): Promise<WalletDto> {
    const wallet = await this.store.findByUserId(userId);
    if (!wallet) {
      throw new NotFoundError('Billetera no encontrada');
    }
    return toWalletDto(wallet, await this.store.balance(wallet.id));
  }

  async topUp(
    walletId: string,
    input: IdempotentCommand & { amount: number; currency?: string; externalReference?: string },
  ): Promise<CommandResult<MovementDto>> {
    const money = Money.fromInput(input.amount, input.currency);
    const userId = await this.activeUser(walletId);
    return this.idempotent(input.idempotencyKey, input.body, async (tx) => {
      await tx.lockWallets([walletId]);
      const movement = await tx.createMovement({
        walletId,
        amount: money.amount,
        direction: 'CREDIT',
        type: 'TOP_UP',
        counterpartyWalletId: null,
        transferId: null,
        reversalOf: null,
        idempotencyKey: input.idempotencyKey,
        externalReference: input.externalReference ?? null,
        reason: null,
        createdBy: input.createdBy,
      });
      await tx.addOutbox({
        eventId: randomUUID(),
        type: 'wallet.credited',
        occurredAt: new Date().toISOString(),
        walletId,
        idUsuario: userId,
        movementId: movement.id,
        amount: money.amount,
        currency: 'PEN',
      });
      return toMovementDto(movement);
    });
  }

  async pay(
    walletId: string,
    input: IdempotentCommand & { amount: number; currency?: string; externalReference?: string },
  ): Promise<CommandResult<MovementDto>> {
    const money = Money.fromInput(input.amount, input.currency);
    const userId = await this.activeUser(walletId);
    return this.idempotent(input.idempotencyKey, input.body, async (tx) => {
      await tx.lockWallets([walletId]);
      assertCanDebit(await tx.balance(walletId), money.amount);
      const movement = await tx.createMovement({
        walletId,
        amount: money.amount,
        direction: 'DEBIT',
        type: 'PAYMENT',
        counterpartyWalletId: null,
        transferId: null,
        reversalOf: null,
        idempotencyKey: input.idempotencyKey,
        externalReference: input.externalReference ?? null,
        reason: null,
        createdBy: input.createdBy,
      });
      await tx.addOutbox({
        eventId: randomUUID(),
        type: 'wallet.debited',
        occurredAt: new Date().toISOString(),
        walletId,
        idUsuario: userId,
        movementId: movement.id,
        amount: money.amount,
        currency: 'PEN',
      });
      return toMovementDto(movement);
    });
  }

  async transfer(
    input: IdempotentCommand & {
      sourceWalletId: string;
      targetWalletId: string;
      amount: number;
      currency?: string;
      externalReference?: string;
    },
  ): Promise<CommandResult<{ transferId: string; movements: MovementDto[] }>> {
    const money = Money.fromInput(input.amount, input.currency);
    if (input.sourceWalletId === input.targetWalletId) {
      throw new UnprocessableError('La transferencia exige dos billeteras distintas');
    }
    const sourceUserId = await this.activeUser(input.sourceWalletId);
    const targetUserId = await this.activeUser(input.targetWalletId);
    return this.idempotent(input.idempotencyKey, input.body, async (tx) => {
      await tx.lockWallets([input.sourceWalletId, input.targetWalletId]);
      assertCanDebit(await tx.balance(input.sourceWalletId), money.amount);
      const transferId = randomUUID();
      const reference = input.externalReference ?? null;
      const outgoing = await tx.createMovement({
        walletId: input.sourceWalletId,
        amount: money.amount,
        direction: 'DEBIT',
        type: 'TRANSFER_OUT',
        counterpartyWalletId: input.targetWalletId,
        transferId,
        reversalOf: null,
        idempotencyKey: input.idempotencyKey,
        externalReference: reference,
        reason: null,
        createdBy: input.createdBy,
      });
      const incoming = await tx.createMovement({
        walletId: input.targetWalletId,
        amount: money.amount,
        direction: 'CREDIT',
        type: 'TRANSFER_IN',
        counterpartyWalletId: input.sourceWalletId,
        transferId,
        reversalOf: null,
        idempotencyKey: null,
        externalReference: reference,
        reason: null,
        createdBy: input.createdBy,
      });
      await tx.addOutbox({
        eventId: randomUUID(),
        type: 'wallet.transferred',
        occurredAt: new Date().toISOString(),
        walletId: input.sourceWalletId,
        idUsuario: sourceUserId,
        movementId: outgoing.id,
        amount: money.amount,
        currency: 'PEN',
        sourceWalletId: input.sourceWalletId,
        targetWalletId: input.targetWalletId,
        transferId,
      });
      return {
        transferId,
        movements: [toMovementDto(outgoing), toMovementDto(incoming)],
      };
    });
  }

  async reverse(
    movementId: string,
    input: IdempotentCommand & { reason: string },
  ): Promise<CommandResult<{ movements: MovementDto[] }>> {
    const walletIds = await this.store.walletIdsForMovement(movementId);
    if (!walletIds) {
      throw new NotFoundError('Movimiento no encontrado');
    }
    for (const walletId of walletIds) {
      await this.activeUser(walletId);
    }
    return this.idempotent(input.idempotencyKey, input.body, async (tx) => {
      const movement = await tx.findMovement(movementId);
      if (!movement) {
        throw new NotFoundError('Movimiento no encontrado');
      }
      const originals = movement.transferId
        ? await tx.movementsByTransfer(movement.transferId)
        : [movement];
      await tx.lockWallets(originals.map((leg) => leg.walletId));
      for (const leg of originals) {
        if (await tx.reversalOf(leg.id)) {
          throw new UnprocessableError('El movimiento ya fue reversado');
        }
      }
      const balances = new Map<string, number>();
      for (const walletId of new Set(originals.map((leg) => leg.walletId))) {
        balances.set(walletId, await tx.balance(walletId));
      }
      for (const leg of originals) {
        const current = balances.get(leg.walletId) ?? 0;
        if (leg.direction === 'CREDIT') {
          assertCanDebit(current, leg.amount);
          balances.set(leg.walletId, current - leg.amount);
        } else {
          balances.set(leg.walletId, current + leg.amount);
        }
      }
      const reversalTransferId = originals.length > 1 ? randomUUID() : null;
      const created: MovementRow[] = [];
      for (const [index, leg] of originals.entries()) {
        created.push(
          await tx.createMovement({
            walletId: leg.walletId,
            amount: leg.amount,
            direction: invertedDirection(leg.direction),
            type: 'REVERSAL',
            counterpartyWalletId: leg.counterpartyWalletId,
            transferId: reversalTransferId,
            reversalOf: leg.id,
            idempotencyKey: index === 0 ? input.idempotencyKey : null,
            externalReference: null,
            reason: input.reason,
            createdBy: input.createdBy,
          }),
        );
      }
      const outgoing = originals.find((leg) => leg.type === 'TRANSFER_OUT');
      const incoming = originals.find((leg) => leg.type === 'TRANSFER_IN');
      await tx.addOutbox({
        eventId: randomUUID(),
        type: 'wallet.movement_reversed',
        occurredAt: new Date().toISOString(),
        walletId: movement.walletId,
        movementId: created[0].id,
        amount: movement.amount,
        currency: 'PEN',
        sourceWalletId: outgoing?.walletId,
        targetWalletId: incoming?.walletId,
        transferId: movement.transferId ?? undefined,
      });
      return { movements: created.map((item) => toMovementDto(item)) };
    });
  }

  async listMovements(
    walletId: string,
    query: { from?: string; to?: string; limit?: number; cursor?: string },
  ): Promise<{ items: MovementDto[]; nextCursor: string | null }> {
    if (!(await this.store.walletExists(walletId))) {
      throw new NotFoundError('Billetera no encontrada');
    }
    const limit = query.limit ?? 20;
    const rows = await this.store.listMovements({
      walletId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      cursor: query.cursor ? decodeCursor(query.cursor) : undefined,
      limit: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map((item) => toMovementDto(item)),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  private async activeUser(walletId: string): Promise<number> {
    const wallet = await this.store.findWallet(walletId);
    if (!wallet) {
      throw new NotFoundError('Billetera no encontrada');
    }
    await this.users.requireActive(wallet.userId);
    return wallet.userId;
  }

  private async idempotent<T>(key: string, body: unknown, work: (tx: StoreTx) => Promise<T>): Promise<CommandResult<T>> {
    const hash = requestHash(body);
    try {
      return await this.store.transaction(async (tx) => {
        const existing = await tx.lockIdempotency(key);
        if (existing) {
          if (existing.requestHash !== hash) {
            throw new ConflictError('La clave de idempotencia ya se usó con otro cuerpo');
          }
          return { status: 200, body: existing.responseBody as T };
        }
        const result = await work(tx);
        await tx.saveIdempotency({
          key,
          requestHash: hash,
          statusCode: 201,
          responseBody: result,
        });
        return { status: 201, body: result };
      });
    } catch (error) {
      if (error instanceof IdempotencyRaceError) {
        const existing = await this.store.findIdempotency(key);
        if (existing && existing.requestHash === hash) {
          return { status: 200, body: existing.responseBody as T };
        }
        throw new ConflictError('La clave de idempotencia ya se usó con otro cuerpo');
      }
      throw error;
    }
  }
}
