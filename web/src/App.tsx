import { Desk } from './Desk'
import { ScrollWorld } from './ScrollWorld'

export function App() {
  return (
    <>
      <nav className="nav">
        <div className="nav-bar">
          <a className="word" href="#inicio">Soles</a>
          <a className="jump" href="#escritorio">Abrir escritorio</a>
        </div>
      </nav>
      <main id="inicio">
        <ScrollWorld />
        <Desk />
      </main>
    </>
  )
}
