/**
 * The taxi route of the current gate departure, for the world to draw. Set by
 * the flight session when a gate flight starts (null in every other mode).
 */

import { create } from 'zustand'
import type { ServiceCommand } from '../game/gateServices'
import type { TaxiRoute } from '../game/groundOps'

interface GroundState {
  route: TaxiRoute | null
  setRoute(route: TaxiRoute | null): void
  /** Commands from the turnaround panel, waiting for the flight session to act on them. */
  queue: ServiceCommand[]
  send(command: ServiceCommand): void
  /** Take every waiting command (the session calls this each step). */
  drain(): ServiceCommand[]
}

export const useGroundStore = create<GroundState>()((set, get) => ({
  route: null,
  setRoute: (route) => set({ route, queue: [] }),
  queue: [],
  send: (command) => set((s) => ({ queue: [...s.queue, command] })),
  drain: () => {
    const q = get().queue
    if (q.length > 0) set({ queue: [] })
    return q
  },
}))
