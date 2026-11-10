export interface Wallet {
  id: string
  idUsuario: number
  currency: 'PEN'
  balance: number
  createdAt: string
}

export interface Movement {
  id: string
  walletId: string
  amount: number
  currency: 'PEN'
  direction: 'CREDIT' | 'DEBIT'
  type: string
  counterpartyWalletId: string | null
  externalReference: string | null
  reversalOf: string | null
  createdAt: string
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

let tokenPromise: Promise<string> | null = null

async function token(): Promise<string> {
  tokenPromise ??= fetch('/session')
    .then(async (response) => {
      if (!response.ok) throw new ApiError('No se pudo abrir la sesión de desarrollo', response.status)
      const body = (await response.json()) as { token: string }
      return body.token
    })
    .catch((error: unknown) => {
      tokenPromise = null
      throw error
    })
  return tokenPromise
}

async function request<T>(path: string, init?: RequestInit & { idempotency?: boolean }): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${await token()}`)
  if (init?.body) headers.set('Content-Type', 'application/json')
  if (init?.idempotency !== false && init?.method && init.method !== 'GET') {
    headers.set('Idempotency-Key', crypto.randomUUID())
  }
  const response = await fetch(path, { ...init, headers })
  if (response.status === 204) return undefined as T
  const payload = (await response.json().catch(() => null)) as { detail?: string; title?: string } | T | null
  if (!response.ok) {
    const problem = payload as { detail?: string; title?: string } | null
    throw new ApiError(problem?.detail || problem?.title || 'La billetera no respondió', response.status)
  }
  return payload as T
}

export const api = {
  openWallet(idUsuario: number) {
    return request<Wallet>('/v1/wallets', { method: 'POST', body: JSON.stringify({ idUsuario }) })
  },
  wallet(id: string) {
    return request<Wallet>(`/v1/wallets/${id}`)
  },
  byOwner(idUsuario: number) {
    return request<Wallet>(`/v1/wallets?idUsuario=${idUsuario}`)
  },
  topUp(id: string, amount: number) {
    return request<Movement>(`/v1/wallets/${id}/top-ups`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    })
  },
  pay(id: string, amount: number) {
    return request<Movement>(`/v1/wallets/${id}/payments`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    })
  },
  transfer(sourceWalletId: string, targetWalletId: string, amount: number) {
    return request<{ transferId: string; movements: Movement[] }>('/v1/transfers', {
      method: 'POST',
      body: JSON.stringify({ sourceWalletId, targetWalletId, amount }),
    })
  },
  movements(id: string) {
    return request<{ items: Movement[]; nextCursor: string | null }>(`/v1/wallets/${id}/movements?limit=20`)
  },
  reverse(id: string, reason: string) {
    return request<{ movements: Movement[] }>(`/v1/movements/${id}/reverse`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    })
  },
}
