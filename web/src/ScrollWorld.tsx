import { useEffect, useRef, useState } from 'react'

const BEATS = [
  {
    title: 'El sol se anota entero.',
    body: 'Cada monto viaja en céntimos. S/ 15.00 es 1500, y el saldo no cruza cero.',
  },
  {
    title: 'Recargar suma. Cobrar resta.',
    body: 'Las dos operaciones quedan escritas. Nada se edita después.',
  },
  {
    title: 'Transferir mueve las dos.',
    body: 'Origen y destino cambian en el mismo instante. Si una falla, ninguna se mueve.',
  },
  {
    title: 'Reversar no borra.',
    body: 'El movimiento original sigue ahí. El deshacer es otro asiento, del mismo monto.',
  },
]

export function ScrollWorld() {
  const flight = useRef<HTMLElement>(null)
  const [progress, setProgress] = useState(0)
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    if (reduced) return
    const node = flight.current
    if (!node) return
    const onScroll = () => {
      const total = node.offsetHeight - window.innerHeight
      const seen = Math.min(Math.max(-node.getBoundingClientRect().top, 0), Math.max(total, 0))
      setProgress(total <= 0 ? 0 : seen / total)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [reduced])

  const beat = Math.min(BEATS.length - 1, Math.floor(progress * BEATS.length))

  return (
    <section className="flight" ref={flight} aria-label="Cómo se mueve un sol">
      <div className="stage">
        <p className="mark" style={reduced ? undefined : { transform: `translateY(${(0.5 - progress) * 28}px)` }}>
          S/
        </p>
        <div className="rail" aria-hidden="true">
          <span style={{ height: `${Math.max(progress, 0.04) * 100}%` }} />
        </div>
        <div className="lines">
          {BEATS.map((item, index) => (
            <div className={reduced || index === beat ? 'line' : 'line off'} key={item.title}>
              {index === 0 ? <h1>{item.title}</h1> : <h2>{item.title}</h2>}
              <p>{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduced(query.matches)
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [])
  return reduced
}
