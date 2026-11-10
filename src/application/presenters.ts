import { InvalidRequestError } from '../domain/errors';
import { MovementRow, WalletRow } from './types';

export interface WalletDto {
  id: string;
  idUsuario: number;
  currency: 'PEN';
  balance: number;
  createdAt: string;
}

export interface MovementDto {
  id: string;
  walletId: string;
  amount: number;
  currency: 'PEN';
  direction: MovementRow['direction'];
  type: MovementRow['type'];
  counterpartyWalletId: string | null;
  externalReference: string | null;
  reversalOf: string | null;
  createdAt: string;
}

export function toWalletDto(wallet: WalletRow, balance: number): WalletDto {
  return {
    id: wallet.id,
    idUsuario: wallet.userId,
    currency: 'PEN',
    balance,
    createdAt: wallet.createdAt.toISOString(),
  };
}

export function toMovementDto(movement: MovementRow): MovementDto {
  return {
    id: movement.id,
    walletId: movement.walletId,
    amount: movement.amount,
    currency: 'PEN',
    direction: movement.direction,
    type: movement.type,
    counterpartyWalletId: movement.counterpartyWalletId,
    externalReference: movement.externalReference,
    reversalOf: movement.reversalOf,
    createdAt: movement.createdAt.toISOString(),
  };
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = raw.lastIndexOf('|');
  const iso = raw.slice(0, separator);
  const id = raw.slice(separator + 1);
  const createdAt = new Date(iso);
  if (separator <= 0 || id.length === 0 || Number.isNaN(createdAt.getTime())) {
    throw new InvalidRequestError('El cursor es inválido');
  }
  return { createdAt, id };
}
