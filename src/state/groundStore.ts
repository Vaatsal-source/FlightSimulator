/**
 * The taxi route of the current gate departure, for the world to draw. Set by
 * the flight session when a gate flight starts (null in every other mode).
 */

import { create } from 'zustand'
import type { TaxiRoute } from '../game/groundOps'

interface GroundState {
  route: TaxiRoute | null
  setRoute(route: TaxiRoute | null): void
}

export const useGroundStore = create<GroundState>()((set) => ({
  route: null,
  setRoute: (route) => set({ route }),
}))
