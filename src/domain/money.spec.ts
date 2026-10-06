import { assertCanDebit, invertedDirection, Money } from './money';
import { InvalidRequestError, UnprocessableError } from './errors';

describe('Money', () => {
  it('acepta céntimos enteros en soles', () => {
    expect(Money.fromInput(1500).amount).toBe(1500);
    expect(Money.fromInput(1500, 'PEN').currency).toBe('PEN');
  });

  it('rechaza decimales, cero y otra moneda', () => {
    expect(() => Money.fromInput(0)).toThrow(InvalidRequestError);
    expect(() => Money.fromInput(1.5)).toThrow(InvalidRequestError);
    expect(() => Money.fromInput(100, 'USD')).toThrow(InvalidRequestError);
  });

  it('impide un débito que deje el saldo negativo', () => {
    expect(() => assertCanDebit(100, 101)).toThrow(UnprocessableError);
    expect(() => assertCanDebit(100, 100)).not.toThrow();
  });

  it('invierte la dirección del movimiento', () => {
    expect(invertedDirection('CREDIT')).toBe('DEBIT');
    expect(invertedDirection('DEBIT')).toBe('CREDIT');
  });
});
