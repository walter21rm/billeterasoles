import {
  IdempotencyRow,
  MovementListQuery,
  MovementRow,
  NewMovement,
  OutboxEvent,
  WalletRow,
} from './types';

export interface StoreTx {
  lockIdempotency(key: string): Promise<IdempotencyRow | null>;
  saveIdempotency(row: IdempotencyRow): Promise<void>;
  findWalletByOwner(ownerId: string): Promise<WalletRow | null>;
  createWallet(ownerId: string): Promise<WalletRow>;
  lockWallets(ids: string[]): Promise<void>;
  balance(walletId: string): Promise<number>;
  createMovement(input: NewMovement): Promise<MovementRow>;
  findMovement(id: string): Promise<MovementRow | null>;
  movementsByTransfer(transferId: string): Promise<MovementRow[]>;
  reversalOf(movementId: string): Promise<MovementRow | null>;
  addOutbox(event: OutboxEvent): Promise<void>;
}

export abstract class WalletStore {
  abstract transaction<T>(work: (tx: StoreTx) => Promise<T>): Promise<T>;
  abstract findIdempotency(key: string): Promise<IdempotencyRow | null>;
  abstract findWallet(id: string): Promise<WalletRow | null>;
  abstract findWalletByOwner(ownerId: string): Promise<WalletRow | null>;
  abstract balance(walletId: string): Promise<number>;
  abstract walletExists(id: string): Promise<boolean>;
  abstract listMovements(query: MovementListQuery): Promise<MovementRow[]>;
}
