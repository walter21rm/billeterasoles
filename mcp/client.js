import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';

const DEFAULT_URL = 'http://52.67.162.209';
const DEFAULT_SECRET = 'dev-only-change-me';
const DEFAULT_ISSUER = 'billetera-dev';

export function createClient(options = {}) {
  const baseUrl = String(options.baseUrl ?? process.env.BILLETERA_URL ?? DEFAULT_URL).replace(/\/$/, '');
  const secret = options.secret ?? process.env.JWT_SECRET ?? DEFAULT_SECRET;
  const issuer = options.issuer ?? process.env.JWT_ISSUER ?? DEFAULT_ISSUER;
  const timeoutMs = options.timeoutMs ?? 15000;
  const fetchImpl = options.fetch ?? globalThis.fetch;

  function token(sub) {
    return jwt.sign({ sub }, secret, { algorithm: 'HS256', issuer });
  }

  async function call({ method, path, sub, body, idempotencyKey, auth = true }) {
    const headers = { Accept: 'application/json' };
    const key = body === undefined ? null : idempotencyKey || randomUUID();
    if (auth) {
      headers.Authorization = `Bearer ${token(sub)}`;
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Idempotency-Key'] = key;
    }

    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      return {
        status: response.status,
        correlationId: response.headers.get('x-correlation-id'),
        idempotencyKey: key,
        body: parseBody(text),
      };
    } catch (error) {
      return {
        status: 0,
        correlationId: null,
        idempotencyKey: key,
        body: { detail: error instanceof Error ? error.message : 'La billetera no respondio' },
      };
    }
  }

  return {
    baseUrl,
    salud() {
      return Promise.all([
        call({ method: 'GET', path: '/health', auth: false }),
        call({ method: 'GET', path: '/health/ready', auth: false }),
      ]).then(([live, ready]) => ({ live, ready }));
    },
    buscarBilletera(idUsuario, sub = 'retiros') {
      return call({ method: 'GET', path: `/v1/wallets?idUsuario=${encodeURIComponent(idUsuario)}`, sub });
    },
    cobrar({ walletId, amount, externalReference, idempotencyKey }) {
      return call({
        method: 'POST',
        path: `/v1/wallets/${walletId}/payments`,
        sub: 'retiros',
        body: amountBody(amount, externalReference),
        idempotencyKey,
      });
    },
    recargar({ walletId, amount, externalReference, idempotencyKey }) {
      return call({
        method: 'POST',
        path: `/v1/wallets/${walletId}/top-ups`,
        sub: 'depositos',
        body: amountBody(amount, externalReference),
        idempotencyKey,
      });
    },
    reversar({ movementId, reason, actor = 'retiros', idempotencyKey }) {
      return call({
        method: 'POST',
        path: `/v1/movements/${movementId}/reverse`,
        sub: actor,
        body: { reason },
        idempotencyKey,
      });
    },
    movimientos({ walletId, limit, cursor, sub = 'retiros' }) {
      const query = new URLSearchParams();
      if (limit !== undefined) query.set('limit', String(limit));
      if (cursor) query.set('cursor', cursor);
      const suffix = query.size > 0 ? `?${query}` : '';
      return call({ method: 'GET', path: `/v1/wallets/${walletId}/movements${suffix}`, sub });
    },
  };
}

function amountBody(amount, externalReference) {
  const body = { amount };
  if (externalReference) body.externalReference = externalReference;
  return body;
}

function parseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
