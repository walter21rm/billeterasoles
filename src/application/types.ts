export type Direction = 'CREDIT' | 'DEBIT';

export type MovementTypeName =
  | 'TOP_UP'
  | 'PAYMENT'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'REVERSAL';

export interface WalletRow {
  id: string;
  userId: number;
  currency: 'PEN';
  createdAt: Date;
}

export interface MovementRow {
  id: string;
  walletId: string;
  amount: number;
  currency: 'PEN';
  direction: Direction;
  type: MovementTypeName;
  counterpartyWalletId: string | null;
  transferId: string | null;
  reversalOf: string | null;
  idempotencyKey: string | null;
  externalReference: string | null;
  reason: string | null;
  createdBy: string;
  createdAt: Date;
}

export interface IdempotencyRow {
  key: string;
  requestHash: string;
  statusCode: number;
  responseBody: unknown;
}

export interface OutboxEvent {
  eventId: string;
  type: string;
  occurredAt: string;
  walletId: string;
  idUsuario?: number;
  movementId?: string;
  amount: number;
  currency: 'PEN';
  sourceWalletId?: string;
  targetWalletId?: string;
  transferId?: string;
}

export interface NewMovement {
  walletId: string;
  amount: number;
  direction: Direction;
  type: MovementTypeName;
  counterpartyWalletId: string | null;
  transferId: string | null;
  reversalOf: string | null;
  idempotencyKey: string | null;
  externalReference: string | null;
  reason: string | null;
  createdBy: string;
}

export interface MovementListQuery {
  walletId: string;
  from?: Date;
  to?: Date;
  cursor?: { createdAt: Date; id: string };
  limit: number;
}
