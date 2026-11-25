import type { MouseEvent } from 'react'
import type { ServiceCommand, ServicesView } from '../game/gateServices'
import { useGameStore } from '../state/gameStore'
import { useGroundStore } from '../state/groundStore'
import { useTelemetry } from '../state/telemetry'
import { formatDistance } from './format'
import './GroundOps.css'

const PHASE_LABEL = {
  coldDark: 'Cold and dark',
  starting: 'Engine start',
  taxi: 'Taxi',
  holdShort: 'Hold short',
  lineUp: 'Line up',
  takeoff: 'Take-off',
  airborne: 'Airborne',
  final: 'Final approach',
  rollout: 'Landing roll',
  vacating: 'Vacate the runway',
  taxiIn: 'Taxi to the gate',
  parking: 'Parking',
  parked: 'Parked',
} as const

const BRIDGE_LABEL = { retracted: 'Retracted', extending: 'Extending', docked: 'Docked', retracting: 'Retracting' } as const

const kg = (v: number): string => `${Math.round(v).toLocaleString('en-US')} kg`

function send(command: ServiceCommand, e?: MouseEvent<HTMLElement>): void {
  useGroundStore.getState().send(command)
  // Keep the keyboard for flying: a focused button would swallow Space (brakes).
  e?.currentTarget.blur()
}

/** The turnaround at the stand: jet bridge, doors, fuel, passengers and the loadsheet. */
function Turnaround({ sv }: { sv: ServicesView }) {
  const sheet = sv.sheet
  const bridgeBusy = sv.bridge === 'extending' || sv.bridge === 'retracting'
  return (
    <section className="go-turn" data-testid="turnaround" aria-label="Turnaround">
      <h3>Turnaround</h3>
      <div className="go-line">
        <span>
          Jet bridge <b>{BRIDGE_LABEL[sv.bridge]}</b>
          {bridgeBusy ? ` ${Math.round(sv.bridgeProgress * 100)}%` : ''}
        </span>
        <button type="button" disabled={bridgeBusy} onClick={(e) => send({ type: 'bridge' }, e)}>
          {sv.bridge === 'docked' || sv.bridge === 'extending' ? 'Retract' : 'Extend'}
        </button>
      </div>
      <div className="go-line">
        <span>
          Doors <b>{sv.doorsOpen ? 'Open' : 'Closed'}</b>
        </span>
        <button type="button" onClick={(e) => send({ type: 'doors' }, e)}>
          {sv.doorsOpen ? 'Close' : 'Open'}
        </button>
      </div>

      <div className="go-line">
        <span>
          Fuel <b>{kg(sv.loading.fuelKg)}</b>
        </span>
        <button type="button" className={sv.refuelling ? 'on' : ''} onClick={(e) => send({ type: 'refuel' }, e)}>
          {sv.refuelling ? 'Stop' : 'Refuel'}
        </button>
      </div>
      <label className="go-slide">
        <span>Target {kg(sv.targetFuelKg)}</span>
        <input
          type="range"
          min={0}
          max={sv.maxFuel}
          step={100}
          value={sv.targetFuelKg}
          aria-label="Fuel target"
          onChange={(e) => send({ type: 'setFuel', kg: Number(e.target.value) })}
        />
      </label>

      <div className="go-line">
        <span>
          Passengers <b>{sv.loading.pax}</b> / {sv.maxPax}
        </span>
        <button type="button" className={sv.paxService !== 'idle' ? 'on' : ''} onClick={(e) => send({ type: 'passengers' }, e)}>
          {sv.paxService === 'idle' ? (sv.targetPax >= sv.loading.pax ? 'Board' : 'Deplane') : 'Stop'}
        </button>
      </div>
      <label className="go-slide">
        <span>Target {sv.targetPax}</span>
        <input
          type="range"
          min={0}
          max={sv.maxPax}
          step={1}
          value={sv.targetPax}
          aria-label="Passenger target"
          onChange={(e) => send({ type: 'setPax', pax: Number(e.target.value) })}
        />
      </label>
      <label className="go-slide">
        <span>Cabin balance: {Math.round(sv.loading.aftShare * 100)}% aft</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={sv.loading.aftShare}
          aria-label="Cabin balance"
          onChange={(e) => send({ type: 'setBalance', aftShare: Number(e.target.value) })}
        />
      </label>

      <dl className="go-sheet" data-testid="loadsheet">
        <div>
          <dt>Gross weight</dt>
          <dd className={sheet.overweight ? 'bad' : ''}>
            {kg(sheet.massKg)}
            {sheet.overweight ? ' OVERWEIGHT' : ''}
          </dd>
        </div>
        <div>
          <dt>CG</dt>
          <dd className={sheet.cgInLimits ? '' : 'bad'}>
            {sheet.cgPct.toFixed(1)}% MAC{sheet.cgInLimits ? '' : ' OUT OF LIMITS'}
          </dd>
        </div>
        <div>
          <dt>Rotate / approach</dt>
          <dd>
            {Math.round(sheet.rotateSpeed * 1.944)} / {Math.round(sheet.approachSpeed * 1.944)} kt
          </dd>
        </div>
      </dl>
      {sv.notice && <p className="go-notice">{sv.notice}</p>}
    </section>
  )
}

/** Gate departure: the tower's latest call, the turnaround, the checklist, and taxi guidance. Shown only in that mode. */
export function GroundOpsPanel() {
  const t = useTelemetry()
  const units = useGameStore((s) => s.settings.units)
  const g = t.ground
  if (!g || g.phase === 'airborne') return null
  const arriving = ['final', 'rollout', 'vacating', 'taxiIn', 'parking', 'parked'].includes(g.phase)
  const done = g.checklist.filter((c) => c.done).length
  const atStand = (g.phase === 'coldDark' || g.phase === 'parked') && g.services !== null
  return (
    <aside className={`ground-ops${atStand ? ' interactive' : ''}`} data-testid="ground-ops" aria-label="Ground operations">
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

      {atStand && g.services && <Turnaround sv={g.services} />}

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
            <strong>{formatDistance(g.taxi.distanceToHold, units)}</strong> {arriving ? 'to the gate' : 'to the hold-short line'}
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
