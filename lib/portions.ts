// How many dinner portions a household eats. Recipes are written per adult portion;
// a child (under 13) counts as half.

export const CHILD_PORTION = 0.5

export interface HouseholdSize {
  adults?: number | null
  children?: number | null
  family_size?: number | null
}

/** Portions to scale a recipe to, or null if the household size is unknown. */
export function portions(h: HouseholdSize | null | undefined): number | null {
  if (!h) return null
  if (h.adults != null) return Math.max(1, h.adults + (h.children ?? 0) * CHILD_PORTION)
  return h.family_size ?? null
}

/** "2 vaksne + 3 born" or "4 personar", for notices. */
export function describeHousehold(h: HouseholdSize | null | undefined): string {
  if (!h) return ''
  if (h.adults != null) {
    const a = `${h.adults} ${h.adults === 1 ? 'vaksen' : 'vaksne'}`
    return h.children ? `${a} + ${h.children} ${h.children === 1 ? 'barn' : 'born'}` : a
  }
  return h.family_size ? `${h.family_size} pers.` : ''
}
