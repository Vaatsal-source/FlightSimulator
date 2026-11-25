import { useTelemetry } from '../state/telemetry'
import { formatDistance } from './format'
import { useGameStore } from '../state/gameStore'
import './GroundOps.css'

const PHASE_LABEL = {
  coldDark: 'Cold and dark',
  starting: 'Engine start',
  taxi: 'Taxi',
  holdShort: 'Hold short',
  lineUp: 'Line up',
  takeoff: 'Take-off',
  airborne: 'Airborne',
} as const

/** Gate departure: the tower's latest call, the checklist, and taxi guidance. Shown only in that mode. */
export function GroundOpsPanel() {
  const t = useTelemetry()
  const units = useGameStore((s) => s.settings.units)
  const g = t.ground
  if (!g || g.phase === 'airborne') return null
  const done = g.checklist.filter((c) => c.done).length
  return (
    <aside className="ground-ops" data-testid="ground-ops" aria-label="Ground operations">
      <header className="go-head">
        <span className="go-phase" data-phase={g.phase}>
          {PHASE_LABEL[g.phase]}
        </span>
        <span className="go-count">
          {done}/{g.checklist.length}
        </span>
      </header>

      <p className="go-atc" role="status">
        {g.atc}
      </p>
      {g.warning && (
        <p className="go-warning" role="alert">
          {g.warning}
        </p>
      )}

      {g.phase === 'starting' && (
        <div className="go-start" aria-label="Engine start progress">
          <div className="go-start-bar" style={{ width: `${Math.round(t.engineStart * 100)}%` }} />
          <span>N1 {Math.round(t.n1 * 100)}%</span>
        </div>
      )}

      {g.taxi && (
        <div className="go-taxi" data-testid="taxi-guidance">
          <svg className="go-arrow" viewBox="0 0 40 40" aria-hidden="true" style={{ transform: `rotate(${g.taxi.bearingRelDeg}deg)` }}>
            <path d="M20 4 L32 30 L20 24 L8 30 Z" />
          </svg>
          <div>
            <strong>{formatDistance(g.taxi.distanceToHold, units)}</strong> to the hold-short line
            <div className="go-sub">Follow the green lights</div>
          </div>
        </div>
      )}

      <ul className="go-list">
        {g.checklist.map((c) => (
          <li key={c.id} className={c.done ? 'done' : ''}>
            <span aria-hidden="true">{c.done ? '✓' : '○'}</span> {c.label}
          </li>
        ))}
      </ul>
      <footer className="go-keys">
        <kbd>N</kbd> engines <kbd>K</kbd> parking brake <kbd>X</kbd> flaps {t.parkingBrake ? <em>PARKING BRAKE SET</em> : null}
      </footer>
    </aside>
  )
}
