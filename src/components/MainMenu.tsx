import { useRef, type CSSProperties, type PointerEvent } from 'react'
import { AIRCRAFT_IDS, getAircraft } from '../config/aircraftCatalog'
import { getAirport } from '../config/airports'
import { GAME_MODES } from '../game/modes'
import { useGameStore } from '../state/gameStore'
import { TIMES_OF_DAY, WEATHERS } from '../world/types'
import { AircraftIcon } from './Hangar'
import './MainMenu.css'

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

interface Action {
  label: string
  hint?: string
  run(): void
}

/** Animated sky behind the menu: pure CSS/SVG, tinted by the chosen time of day. */
function Backdrop() {
  const aircraftId = useGameStore((s) => s.aircraftId)
  return (
    <div className="menu-sky" aria-hidden="true">
      <div className="menu-sun" />
      <div className="menu-clouds far" />
      <div className="menu-clouds near" />
      <svg className="menu-ridge" viewBox="0 0 1200 200" preserveAspectRatio="none">
        <path d="M0 200 L0 120 C90 90 160 60 260 82 C360 104 420 40 540 52 C640 62 720 110 820 96 C930 80 1040 30 1200 74 L1200 200 Z" />
      </svg>
      <svg className="menu-airfield" viewBox="0 0 300 60" aria-hidden="true">
        <path d="M0 60 L0 48 L40 48 L40 36 L70 36 L70 48 L120 48 L120 30 L126 30 L126 14 L132 14 L132 30 L138 30 L138 48 L190 48 L190 40 L240 40 L240 48 L300 48 L300 60 Z" />
        <path className="menu-runway" d="M20 56 L280 56" />
      </svg>
      <svg className="menu-island" viewBox="0 0 1200 200" preserveAspectRatio="none">
        <path d="M0 200 L0 150 C120 140 200 90 320 100 C420 108 470 60 560 70 C660 80 700 130 820 120 C930 110 1010 140 1200 135 L1200 200 Z" />
      </svg>
      <div className="menu-sea" />
      <div className="menu-flyby">
        <AircraftIcon id={aircraftId} />
      </div>
    </div>
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
    <section className="panel ready-card" aria-label="Ready to fly">
      <div className="ready-label">Ready to fly</div>
      <div className="ready-aircraft">
        <button type="button" className="ready-arrow" aria-label="Previous aircraft" onClick={() => step(-1)}>
          ‹
        </button>
        <div className="ready-plane" key={aircraftId}>
          <AircraftIcon id={aircraftId} />
          <div className="ready-name" data-testid="ready-aircraft">
            {aircraft.name}
          </div>
          <div className="ready-sub">
            {aircraft.manufacturer} · {aircraft.role}
          </div>
        </div>
        <button type="button" className="ready-arrow" aria-label="Next aircraft" onClick={() => step(1)}>
          ›
        </button>
      </div>
      <ul className="ready-specs" aria-label="Aircraft facts">
        {aircraft.specs.slice(0, 3).map((sp) => (
          <li key={sp.label}>
            <span>{sp.label}</span>
            <strong>{sp.value}</strong>
          </li>
        ))}
      </ul>
      <div className="ready-dots" aria-hidden="true">
        {AIRCRAFT_IDS.map((id) => (
          <span key={id} className={id === aircraftId ? 'dot on' : 'dot'} />
        ))}
      </div>
      <dl className="ready-facts">
        <div>
          <dt>Airport</dt>
          <dd data-testid="ready-airport">
            {airport.code} · {airport.name}
          </dd>
        </div>
        <div>
          <dt>Runway</dt>
          <dd>{runwayEnd}</dd>
        </div>
      </dl>
      <div className="ready-time" role="radiogroup" aria-label="Time of day">
        {TIMES_OF_DAY.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={t === timeOfDay}
            className={t === timeOfDay ? 'time-chip active' : 'time-chip'}
            onClick={() => updateSettings({ timeOfDay: t })}
          >
            {cap(t)}
          </button>
        ))}
      </div>
      <div className="ready-time" role="radiogroup" aria-label="Weather">
        {WEATHERS.map((w) => (
          <button
            key={w}
            type="button"
            role="radio"
            aria-checked={w === weather}
            className={w === weather ? 'time-chip active' : 'time-chip'}
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
    <section className="panel pilot-log" aria-label="Pilot log">
      <div className="ready-label">Pilot log</div>
      {entries.length === 0 ? (
        <p className="log-empty">No scores yet. Finish a challenge or lesson to set your first best.</p>
      ) : (
        <ul className="log-list">
          {entries.map((m) => (
            <li key={m.id}>
              <span>{m.name}</span>
              <span className="log-score">{Math.round(bestScores[m.id] ?? 0)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const ICONS = {
  gate: 'M3 17h18M5 17l2-9h4l1 4h5l2 5M9 8V5h3',
  quick: 'M3 12h14M13 6l7 6-7 6',
  pick: 'M4 6h16M4 12h10M4 18h16',
} as const

function Icon({ path }: { path: string }) {
  return (
    <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  )
}

/** Title screen: animated backdrop, main actions, the current flight setup and best scores. */
export function MainMenu() {
  const goToModeSelect = useGameStore((s) => s.goToModeSelect)
  const startFlight = useGameStore((s) => s.startFlight)
  const openOverlay = useGameStore((s) => s.openOverlay)
  const timeOfDay = useGameStore((s) => s.settings.timeOfDay)
  const rootRef = useRef<HTMLDivElement>(null)

  const primary: (Action & { icon: string })[] = [
    { label: 'Gate Departure', hint: 'Cold and dark at the stand: start up, taxi, take off', icon: ICONS.gate, run: () => startFlight('gate') },
    { label: 'Quick Flight', hint: 'Straight onto the runway in your current aircraft', icon: ICONS.quick, run: () => startFlight('freeFlight') },
    { label: 'Fly', hint: 'Choose your aircraft, airport and runway', icon: ICONS.pick, run: goToModeSelect },
  ]
  const secondary: Action[] = [
    { label: 'How It Works', run: () => openOverlay('howItWorks') },
    { label: 'Settings', run: () => openOverlay('settings') },
    { label: 'Controls', run: () => openOverlay('controls') },
  ]

  // Parallax: backdrop layers lean toward the pointer through CSS variables, without re-rendering.
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = rootRef.current
    if (!el || e.pointerType === 'touch') return
    el.style.setProperty('--mx', ((e.clientX / window.innerWidth) * 2 - 1).toFixed(3))
    el.style.setProperty('--my', ((e.clientY / window.innerHeight) * 2 - 1).toFixed(3))
  }

  return (
    <div
      ref={rootRef}
      className={`screen main-menu tod-${timeOfDay}`}
      style={{ '--mx': 0, '--my': 0 } as CSSProperties}
      onPointerMove={onPointerMove}
    >
      <Backdrop />
      <div className="menu-layout">
        <div className="panel menu-hero">
          <h1 className="title">FlySim</h1>
          <p className="subtitle">Island flight simulator</p>
          <div className="menu-actions">
            {primary.map((a, i) => (
              <div key={a.label} className="menu-action">
                <button
                  type="button"
                  className={i === 0 ? 'btn primary menu-btn' : 'btn menu-btn'}
                  autoFocus={i === 0}
                  aria-label={a.label}
                  aria-describedby={`menu-hint-${i}`}
                  onClick={a.run}
                >
                  <Icon path={a.icon} />
                  <span className="menu-btn-text">
                    {a.label}
                    <span id={`menu-hint-${i}`} className="menu-hint">
                      {a.hint}
                    </span>
                  </span>
                </button>
              </div>
            ))}
          </div>
          <div className="menu-secondary">
            {secondary.map((a) => (
              <button key={a.label} type="button" className="btn ghost" onClick={a.run}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
        <div className="menu-side">
          <ReadyCard />
          <PilotLog />
        </div>
      </div>
      <MenuFooter />
    </div>
  )
}

const REPO_URL = 'https://github.com/SingeyDorje21/flysim'

function MenuFooter() {
  return (
    <footer className="menu-footer">
      <a className="panel menu-footer-card" href={REPO_URL} target="_blank" rel="noopener noreferrer">
        <svg className="github-mark" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
        <span className="menu-footer-text">
          <strong>FlySim is open source</strong>
          <span>Want to add something? Open a pull request on GitHub.</span>
        </span>
        <span className="menu-footer-cta">
          Contribute <span aria-hidden="true">→</span>
        </span>
      </a>
    </footer>
  )
}
