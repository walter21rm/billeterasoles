import { InvalidRequestError, UnprocessableError } from './errors';

export class Money {
  readonly currency = 'PEN' as const;

  private constructor(readonly amount: number) {}

  static fromInput(amount: number, currency?: string): Money {
    if (currency !== undefined && currency !== 'PEN') {
      throw new InvalidRequestError('La moneda debe ser PEN');
    }
    if (!Number.isInteger(amount) || amount <= 0 || amount > 2_147_483_647) {
      throw new InvalidRequestError('El monto debe ser un entero de céntimos mayor que cero');
    }
    return new Money(amount);
  }
}

export function assertCanDebit(balance: number, amount: number): void {
  if (balance < amount) {
    throw new UnprocessableError('Saldo insuficiente');
  }
}

export function invertedDirection(direction: 'CREDIT' | 'DEBIT'): 'CREDIT' | 'DEBIT' {
  return direction === 'CREDIT' ? 'DEBIT' : 'CREDIT';
}
