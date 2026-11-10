import { FormEvent, useEffect, useState } from 'react'
import { api, ApiError, Movement, Wallet } from './api'
import { formatSoles, solesToCents } from './money'

const STORAGE = 'soles-user-id'

const LABELS: Record<string, string> = {
  TOP_UP: 'Recarga',
  PAYMENT: 'Cobro',
  TRANSFER_OUT: 'Salida',
  TRANSFER_IN: 'Entrada',
  REVERSAL: 'Reversa',
}

export function Desk() {
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [movements, setMovements] = useState<Movement[]>([])
  const [userDraft, setUserDraft] = useState('')
  const [amount, setAmount] = useState('15.00')
  const [target, setTarget] = useState('')
  const [tip, setTip] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE)
    if (!saved) return
    setUserDraft(saved)
    void loadOwner(Number(saved))
  }, [])

  async function loadOwner(idUsuario: number) {
    if (!Number.isInteger(idUsuario) || idUsuario <= 0) return
    try {
      const found = await api.byOwner(idUsuario)
      await show(found)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) return
      setError(messageOf(caught))
    }
  }

  async function show(next: Wallet) {
    sessionStorage.setItem(STORAGE, String(next.idUsuario))
    setWallet(next)
    const page = await api.movements(next.id)
    setMovements(page.items)
  }

  async function run(work: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  function cents(): number | null {
    const value = solesToCents(amount)
    if (value === null) setError('Escribe un monto en soles, con hasta dos decimales.')
    return value
  }

  async function open(event: FormEvent) {
    event.preventDefault()
    const idUsuario = Number(userDraft.trim())
    if (!Number.isInteger(idUsuario) || idUsuario <= 0) {
      setError('Escribe el id de usuario que devolvió el servicio de usuarios.')
      return
    }
    await run(async () => {
      try {
        const created = await api.openWallet(idUsuario)
        setTip(0)
        await show(created)
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 409) {
          await show(await api.byOwner(idUsuario))
          return
        }
        throw caught
      }
    })
  }

  async function topUp(event: FormEvent) {
    event.preventDefault()
    if (!wallet) return
    const value = cents()
    if (value === null) return
    await run(async () => {
      await api.topUp(wallet.id, value)
      setTip(-6)
      await show(await api.wallet(wallet.id))
      window.setTimeout(() => setTip(0), 360)
    })
  }

  async function pay() {
    if (!wallet) return
    const value = cents()
    if (value === null) return
    await run(async () => {
      await api.pay(wallet.id, value)
      setTip(6)
      await show(await api.wallet(wallet.id))
      window.setTimeout(() => setTip(0), 360)
    })
  }

  async function transfer(event: FormEvent) {
    event.preventDefault()
    if (!wallet) return
    const value = cents()
    if (value === null) return
    await run(async () => {
      await api.transfer(wallet.id, target.trim(), value)
      setTip(6)
      await show(await api.wallet(wallet.id))
      window.setTimeout(() => setTip(0), 360)
    })
  }

  async function reverse(movement: Movement) {
    const reason = window.prompt('Motivo de la reversa')
    if (!reason || !wallet) return
    await run(async () => {
      await api.reverse(movement.id, reason.trim())
      setTip(movement.direction === 'CREDIT' ? 6 : -6)
      await show(await api.wallet(wallet.id))
      window.setTimeout(() => setTip(0), 360)
    })
  }

  return (
    <section className="desk" id="escritorio">
      <div className="desk-inner">
        <header className="mast">
            <p className="kicker">{wallet ? 'Saldo disponible' : 'Escritorio'}</p>
          <h2>{wallet ? formatSoles(wallet.balance) : 'Abre la billetera'}</h2>
          <span className="tick" style={{ transform: `translateX(${tip * 6}px)` }} />
          <p className="owner">
            {wallet ? `Usuario ${wallet.idUsuario}` : 'El titular es el id_usuario del servicio de usuarios.'}
          </p>
        </header>

        {error ? <p className="note bad">{error}</p> : null}

        {!wallet ? (
          <form onSubmit={(event) => void open(event)}>
            <label>
              Id de usuario
              <input
                inputMode="numeric"
                value={userDraft}
                onChange={(event) => setUserDraft(event.target.value)}
                placeholder="id_usuario"
                autoComplete="off"
              />
            </label>
            <div className="row">
              <button className="primary" type="submit" disabled={busy}>
                Abrir billetera
              </button>
            </div>
          </form>
        ) : (
          <div className="work">
            <div className="actions">
            <form onSubmit={(event) => void topUp(event)}>
              <label>
                Monto en soles
                <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
              </label>
              <div className="row">
                <button className="primary" type="submit" disabled={busy}>Recargar</button>
                <button className="ghost" type="button" disabled={busy} onClick={() => void pay()}>Cobrar</button>
              </div>
              <p className="note">Id de esta billetera: {wallet.id}</p>
            </form>
            <form onSubmit={(event) => void transfer(event)}>
              <label>
                Billetera de destino
                <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="UUID" autoComplete="off" />
              </label>
              <div className="row">
                <button className="ghost" type="submit" disabled={busy || target.trim() === ''}>
                  Transferir
                </button>
              </div>
            </form>
            </div>

            <div className="ledger">
              <h2>Movimientos</h2>
              {movements.length === 0 ? <p className="note">Todavía no hay movimientos.</p> : null}
              <ol>
                {movements.map((movement) => (
                  <li key={movement.id}>
                    <span>
                      {LABELS[movement.type] ?? movement.type}
                      <span className="when">{new Date(movement.createdAt).toLocaleString('es-PE')}</span>
                    </span>
                    <span className={movement.direction === 'CREDIT' ? 'credit' : 'debit'}>
                      {movement.direction === 'CREDIT' ? '+' : '−'}
                      {formatSoles(movement.amount)}
                    </span>
                    <button className="textish" type="button" disabled={busy} onClick={() => void reverse(movement)}>
                      Reversar
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function messageOf(caught: unknown): string {
  if (caught instanceof ApiError) return caught.message
  return 'No hay conexión con la billetera.'
}
