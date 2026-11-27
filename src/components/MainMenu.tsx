import { type CSSProperties } from 'react'
import { AIRCRAFT_IDS, getAircraft } from '../config/aircraftCatalog'
import { getAirport } from '../config/airports'
import { GAME_MODES } from '../game/modes'
import { useGameStore } from '../state/gameStore'
import { TIMES_OF_DAY, WEATHERS } from '../world/types'
import './MainMenu.css'

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

interface Action {
  label: string
  hint: string
  icon: string
  run(): void
}

const BACKDROP = `${import.meta.env.BASE_URL}BackdropImageMenu.jpg`

/** Stroke paths for the 24 x 24 button icons. */
const ICONS = {
  gate: 'M3 17h18M5 17l2-9h4l1 4h5l2 5M9 8V5h3',
  quick: 'M5 4l14 8-14 8z',
  pick: 'M4 6h16M4 12h10M4 18h16',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L6 8l-2-.5-1 3 2 1v2l-2 1 1 3 2-.5L7.5 18l-.5 2 3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3-2-1z',
  controls: 'M4 8h16v9H4zM8 12h2M14 12h2M7 5h10',
  help: 'M5 4h6a2 2 0 012 2v14a2 2 0 00-2-2H5zM19 4h-6a2 2 0 00-2 2v14a2 2 0 012-2h6z',
} as const

function Icon({ path }: { path: string }) {
  return (
    <svg className="mm-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  )
}

/** The aircraft, airport and time of day that Quick Flight (and every mode) will use. */
function ReadyCard() {
  const aircraftId = useGameStore((s) => s.aircraftId)
  const airportId = useGameStore((s) => s.airportId)
  const runwayEnd = useGameStore((s) => s.runwayEnd)
  const timeOfDay = useGameStore((s) => s.settings.timeOfDay)
  const weather = useGameStore((s) => s.settings.weather)
  const selectAircraft = useGameStore((s) => s.selectAircraft)
  const updateSettings = useGameStore((s) => s.updateSettings)
  const aircraft = getAircraft(aircraftId)
  const airport = getAirport(airportId)

  const step = (delta: number) => {
    const i = AIRCRAFT_IDS.indexOf(aircraftId)
    selectAircraft(AIRCRAFT_IDS[(i + delta + AIRCRAFT_IDS.length) % AIRCRAFT_IDS.length])
  }

  return (
    <section className="mm-card" aria-label="Ready to fly">
      <div className="mm-card-label">Ready to fly</div>
      <div className="mm-aircraft">
        <button type="button" className="mm-arrow" aria-label="Previous aircraft" onClick={() => step(-1)}>
          ‹
        </button>
        <div className="mm-plane" key={aircraftId}>
          <div className="mm-plane-name" data-testid="ready-aircraft">
            {aircraft.name}
          </div>
          <div className="mm-plane-sub">
            {aircraft.manufacturer} · {aircraft.role}
          </div>
        </div>
        <button type="button" className="mm-arrow" aria-label="Next aircraft" onClick={() => step(1)}>
          ›
        </button>
      </div>
      <div className="mm-dots" aria-hidden="true">
        {AIRCRAFT_IDS.map((id) => (
          <span key={id} className={id === aircraftId ? 'on' : ''} />
        ))}
      </div>
      <div className="mm-where">
        <span data-testid="ready-airport">
          {airport.code} · {airport.name}
        </span>
        <span>Runway {runwayEnd}</span>
      </div>
      <div className="mm-chips" role="radiogroup" aria-label="Time of day">
        {TIMES_OF_DAY.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={t === timeOfDay}
            className={t === timeOfDay ? 'mm-chip active' : 'mm-chip'}
            onClick={() => updateSettings({ timeOfDay: t })}
          >
            {cap(t)}
          </button>
        ))}
      </div>
      <div className="mm-chips" role="radiogroup" aria-label="Weather">
        {WEATHERS.map((w) => (
          <button
            key={w}
            type="button"
            role="radio"
            aria-checked={w === weather}
            className={w === weather ? 'mm-chip active' : 'mm-chip'}
            onClick={() => updateSettings({ weather: w })}
          >
            {cap(w)}
          </button>
        ))}
      </div>
    </section>
  )
}

function PilotLog() {
  const bestScores = useGameStore((s) => s.bestScores)
  const entries = GAME_MODES.filter((m) => bestScores[m.id] !== undefined)
  return (
    <section className="mm-card mm-log" aria-label="Pilot log">
      <div className="mm-card-label">Pilot log</div>
      {entries.length === 0 ? (
        <p className="mm-log-empty">No scores yet. Finish a challenge or lesson to set your first best.</p>
      ) : (
        <ul className="mm-log-list">
          {entries.map((m) => (
            <li key={m.id}>
              <span>{m.name}</span>
              <span className="mm-log-score">{Math.round(bestScores[m.id] ?? 0)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Title screen: a photograph of the sky, the game's name, a stack of angled buttons, and the flight setup. */
export function MainMenu() {
  const goToModeSelect = useGameStore((s) => s.goToModeSelect)
  const startFlight = useGameStore((s) => s.startFlight)
  const openOverlay = useGameStore((s) => s.openOverlay)

  const actions: Action[] = [
    { label: 'Gate Departure', hint: 'Cold and dark at the stand: start up, taxi, take off', icon: ICONS.gate, run: () => startFlight('gate') },
    { label: 'Quick Flight', hint: 'Straight onto the runway in your current aircraft', icon: ICONS.quick, run: () => startFlight('freeFlight') },
    { label: 'Fly', hint: 'Choose your aircraft, airport and runway', icon: ICONS.pick, run: goToModeSelect },
    { label: 'Settings', hint: 'Quality, wind, units and more', icon: ICONS.settings, run: () => openOverlay('settings') },
    { label: 'Controls', hint: 'Every key, in one list', icon: ICONS.controls, run: () => openOverlay('controls') },
    { label: 'How It Works', hint: 'Learn the basics', icon: ICONS.help, run: () => openOverlay('howItWorks') },
  ]

  return (
    <div className="screen main-menu">
      <div className="mm-bg" style={{ backgroundImage: `url(${BACKDROP})` }} aria-hidden="true" />
      <div className="mm-shade" aria-hidden="true" />

      <header className="mm-top">
        <div className="mm-logo">
          <svg className="mm-swoosh" viewBox="0 0 120 40" aria-hidden="true">
            <path className="mm-swoosh-trail" d="M0 36 C30 34 60 24 100 8" />
            <path className="mm-swoosh-plane" d="M88 12 L112 3 L108 8 L118 6 L104 14 L98 22 L96 14 Z" />
          </svg>
          <h1 className="mm-title">FlySim</h1>
          <p className="mm-subtitle">
            <span /> Flight simulator <span />
          </p>
        </div>
        <div className="mm-tag">Fly • Explore • Discover</div>
      </header>

      <nav className="mm-nav" aria-label="Main menu">
        {actions.map((a, i) => (
          <button
            key={a.label}
            type="button"
            className={i === 0 ? 'mm-btn primary' : 'mm-btn'}
            style={{ '--i': i } as CSSProperties}
            autoFocus={i === 0}
            aria-label={a.label}
            aria-describedby={`mm-hint-${i}`}
            onClick={a.run}
          >
            <Icon path={a.icon} />
            <span className="mm-btn-text">
              <span className="mm-btn-title">{a.label}</span>
              <span id={`mm-hint-${i}`} className="mm-btn-hint">
                {a.hint}
              </span>
            </span>
          </button>
        ))}
      </nav>

      <aside className="mm-setup">
        <ReadyCard />
        <PilotLog />
      </aside>

      <footer className="mm-foot">
        <span className="mm-version">FlySim v0.1.0</span>
        <span className="mm-motto">The sky is just the beginning</span>
      </footer>
    </div>
  )
}
