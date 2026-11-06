// Tomo's general Hatch: for a student whose school has no pack ("My school is not listed", or after removing the
// school pack). For the student it is just another pack, built into the app; it never runs next to a pack's Hatch.
import { parse } from 'yaml'
import raw from './core-hatch.yaml?raw'
import type { Hatch } from './types'

export const CORE_HATCH = parse(raw) as Hatch

/** The Hatch a student answers: the school pack's, or Tomo's general one. */
export const activeHatch = (packHatch: Hatch | undefined): Hatch => packHatch ?? CORE_HATCH
