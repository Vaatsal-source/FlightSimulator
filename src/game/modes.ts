import type { GameMode } from './types'

export interface GameModeInfo {
  id: GameMode
  /** 'challenge' modes appear on Choose a mode; 'lesson' modes live in Flight School. */
  kind: 'challenge' | 'lesson'
  name: string
  tagline: string
  description: string
  objectives: string[]
  /** Seconds, or null for unlimited. */
  timeLimit: number | null
}

export const GAME_MODES: readonly GameModeInfo[] = [
  {
    id: 'freeFlight',
    kind: 'challenge',
    name: 'Free Flight',
    tagline: 'Explore the island at your own pace',
    description:
      'Start on your chosen runway with the engine idling. Take off, explore the island and land wherever you dare. No time limit.',
    objectives: ['No objectives - just fly', 'The flight ends only if you crash or quit'],
    timeLimit: null,
  },
  {
    id: 'gate',
    kind: 'challenge',
    name: 'Gate Departure',
    tagline: 'Cold and dark at the stand: start up, taxi, take off',
    description:
      'You are parked at the apron with the engines off and the parking brake set. Start the engines (N), release the brake (K), taxi along the green lights to the hold-short line, wait for the tower, line up and take off.',
    objectives: [
      'Start the engines, set the take-off flaps, release the parking brake',
      'Taxi to the hold-short line at 15 knots or less and wait for clearance',
      'Line up on the runway and take off',
    ],
    timeLimit: null,
  },
  {
    id: 'arrival',
    kind: 'challenge',
    name: 'Gate Arrival',
    tagline: 'Land, taxi in, park and unload',
    description:
      'You are on a 3-degree final approach. Land, vacate the runway at the green lights, taxi to the gate and stop on the line. Set the parking brake, shut the engines down, then connect the jet bridge, open the doors and deplane.',
    objectives: [
      'Land and vacate the runway',
      'Taxi to the gate at 15 knots or less and park square on the line',
      'Shut down, connect the bridge and deplane the passengers',
    ],
    timeLimit: null,
  },
  {
    id: 'takeoff',
    // Not offered any more; the Flight School lessons still spawn through this mode.
    kind: 'lesson',
    name: 'Take-off Challenge',
    tagline: 'Get airborne and climb out cleanly',
    description:
      'Line up on your chosen runway with take-off flaps. Apply full power, rotate at the aircraft rotation speed and climb to 500 ft above the ground.',
    objectives: [
      'Stay on the runway until you lift off',
      'Climb to 500 ft (150 m) above the ground',
      'Bonus: keep the wings within 30 degrees of level and stay on the centreline',
    ],
    timeLimit: 120,
  },
  {
    id: 'landing',
    // Not offered any more; the Flight School lessons still spawn through this mode.
    kind: 'lesson',
    name: 'Landing Challenge',
    tagline: 'Bring it down gently on your chosen runway',
    description:
      'You are on a 3-degree final approach, 2 miles out. Land on the runway, ideally near the aiming point, and stop on the paved surface.',
    objectives: [
      'Touch down gently on the runway - a hard landing costs points, a very hard one breaks the gear',
      'Come to a complete stop on the runway',
      'Bonus: gentle touchdown near the aiming point, on the centreline',
    ],
    timeLimit: 240,
  },
  {
    id: 'rings',
    kind: 'challenge',
    name: 'Ring Course',
    tagline: 'Thread the needle through every ring',
    description:
      'Start airborne south of the airport and fly through each ring in order. The next ring is highlighted. Fastest time wins.',
    objectives: ['Fly through every ring in order', 'Do not crash', 'Finish before the time runs out'],
    timeLimit: 360,
  },
  {
    id: 'lessonTakeoff',
    kind: 'lesson',
    name: 'Take-off Lesson',
    tagline: 'Step-by-step take-off with a coach',
    description:
      'A coach talks you through power, steering, rotation, gear and climb-out for the selected aircraft, with live targets and assists.',
    objectives: ['Follow each step on the coach panel', 'Climb to 1,000 ft above the ground'],
    timeLimit: null,
  },
  {
    id: 'lessonLanding',
    kind: 'lesson',
    name: 'Landing Lesson',
    tagline: 'Step-by-step landing with a coach',
    description:
      'Start on a stable final approach. The coach guides you down the glide path, through the flare and the rollout, with live targets and callouts.',
    objectives: ['Follow each step on the coach panel', 'Touch down gently and stop on the runway'],
    timeLimit: null,
  },
  {
    id: 'lessonCircuit',
    kind: 'lesson',
    name: 'Circuit Lesson',
    tagline: 'Take off, fly a circuit and land, with a coach',
    description:
      'The full flight: take off, climb to circuit height, fly the crosswind, downwind and base legs around the airport, then line up and land on the same runway.',
    objectives: ['Take off and fly each leg of the circuit', 'Land and stop on the runway you took off from'],
    timeLimit: null,
  },
]

export function getModeInfo(mode: GameMode): GameModeInfo {
  const info = GAME_MODES.find((m) => m.id === mode)
  if (!info) throw new Error(`Unknown game mode: ${mode}`)
  return info
}
