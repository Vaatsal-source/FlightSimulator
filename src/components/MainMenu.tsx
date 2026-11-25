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

/** Runway in perspective: dashes and edge lights shrinking towards the vanishing point (600, 0). */
const RUNWAY_ROWS = Array.from({ length: 11 }, (_, k) => {
  const y = (v: number) => 500 * Math.pow(v / 11, 2.1)
  const y1 = y(k + 0.15)
  const y2 = y(k + 0.65)
  const w = (yy: number) => 1 + 13 * (yy / 500)
  const edge = (yy: number) => 3 + 447 * (yy / 500)
  return { k, y1, y2, w1: w(y1), w2: w(y2), edge: edge(y2), r: 1.2 + 5 * (y2 / 500) }
})

const TERMINAL_WINDOWS = Array.from({ length: 34 }, (_, i) => i)

/** The view down the runway at an airport, pure CSS/SVG, tinted by the chosen time of day. */
function Backdrop() {
  const aircraftId = useGameStore((s) => s.aircraftId)
  return (
    <div className="menu-sky" aria-hidden="true">
      <div className="menu-stars" />
      <div className="menu-sun" />
      <div className="menu-clouds far" />
      <div className="menu-clouds near" />
      <div className="menu-flyby">
        <AircraftIcon id={aircraftId} />
      </div>
      <svg className="menu-skyline" viewBox="0 0 1200 120" preserveAspectRatio="xMidYMax slice">
        {/* Terminal with its glass face, a tower, a hangar, fuel tanks and parked jets on the apron. */}
        <rect className="sk-far" x="0" y="96" width="1200" height="24" />
        <rect className="sk-building" x="40" y="74" width="420" height="30" />
        <rect className="sk-roof" x="40" y="70" width="420" height="5" />
        {TERMINAL_WINDOWS.map((i) => (
          <rect key={i} className="sk-window" x={50 + i * 12} y="82" width="7" height="6" style={{ animationDelay: `${(i * 0.37) % 5}s` }} />
        ))}
        <rect className="sk-building" x="470" y="80" width="90" height="24" />
        <path className="sk-building" d="M120 74 V72 H150 V74 Z" />
        <rect className="sk-building" x="640" y="58" width="9" height="46" />
        <path className="sk-building" d="M634 58 L655 58 L660 46 L629 46 Z" />
        <rect className="sk-window" x="632" y="49" width="26" height="4" />
        <circle className="sk-beacon" cx="644.5" cy="43" r="2.2" />
        <rect className="sk-building" x="760" y="78" width="110" height="26" />
        <path className="sk-roof" d="M756 78 Q815 62 874 78 Z" />
        <ellipse className="sk-tank" cx="940" cy="92" rx="16" ry="12" />
        <ellipse className="sk-tank" cx="978" cy="92" rx="16" ry="12" />
        <ellipse className="sk-tank" cx="1016" cy="92" rx="16" ry="12" />
        {[210, 330, 1080].map((x) => (
          <g key={x} className="sk-jet" transform={`translate(${x} 100)`}>
            <ellipse cx="0" cy="-5" rx="30" ry="4.6" />
            <path d="M24 -6 L36 -22 L40 -22 L34 -5 Z" />
            <path d="M-4 -5 L-14 3 L4 3 Z" />
          </g>
        ))}
      </svg>
      <svg className="menu-runway-view" viewBox="0 0 1200 500" preserveAspectRatio="xMidYMax slice">
        <defs>
          <linearGradient id="menu-asphalt" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2b2f38" />
            <stop offset="1" stopColor="#15171c" />
          </linearGradient>
        </defs>
        <rect className="rv-ground" x="0" y="0" width="1200" height="500" />
        {/* Taxiway to the right with its blue edge lights, and a stand with its yellow line. */}
        <polygon className="rv-taxi" points="640,0 660,0 1150,500 880,500" />
        {RUNWAY_ROWS.map((r) => (
          <circle key={`b${r.k}`} className="rv-blue" cx={600 + r.edge * 1.95} cy={r.y2} r={r.r * 0.7} />
        ))}
        <polygon className="rv-runway" points="598,0 602,0 1050,500 150,500" fill="url(#menu-asphalt)" />
        <polygon className="rv-edge" points="598,0 599,0 150,500 146,500" />
        <polygon className="rv-edge" points="602,0 601,0 1050,500 1054,500" />
        {RUNWAY_ROWS.map((r) => (
          <polygon
            key={`d${r.k}`}
            className="rv-dash"
            points={`${600 - r.w1 / 2},${r.y1} ${600 + r.w1 / 2},${r.y1} ${600 + r.w2 / 2},${r.y2} ${600 - r.w2 / 2},${r.y2}`}
          />
        ))}
        {/* Threshold bars near the viewer. */}
        {[-5, -4, -3, -2, 2, 3, 4, 5].map((n) => (
          <polygon key={`t${n}`} className="rv-dash" points={`${600 + n * 52 - 11},392 ${600 + n * 52 + 11},392 ${600 + n * 60 + 15},470 ${600 + n * 60 - 15},470`} />
        ))}
        {RUNWAY_ROWS.map((r) => (
          <g key={`l${r.k}`}>
            <circle className="rv-light" cx={600 - r.edge} cy={r.y2} r={r.r} style={{ animationDelay: `${(10 - r.k) * 0.12}s` }} />
            <circle className="rv-light" cx={600 + r.edge} cy={r.y2} r={r.r} style={{ animationDelay: `${(10 - r.k) * 0.12}s` }} />
            <circle className="rv-green" cx={600 - r.edge * 1.04} cy={r.y2} r={r.r * 0.6} />
          </g>
        ))}
      </svg>
      <div className="menu-haze" />
      <div className="menu-vignette" />
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
          <p className="subtitle">Flight simulator</p>
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
    </div>
  )
}
