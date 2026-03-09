export interface Household {
  id: string
  name: string
  pin_hash: string
  household_code: string
  family_size: number
  is_admin: boolean
  created_at: string
  updated_at: string
}

export interface Section {
  id: string
  name_nn: string
  name_nb: string | null
  name_en: string | null
  icon: string
  color: string
  default_sort_order: number
}

export interface Store {
  id: string
  name: string
  chain: string
  address: string | null
  city: string
  latitude: number | null
  longitude: number | null
  is_mapped: boolean
  mapped_by_household_id: string | null
  created_at: string
}

export interface StoreMap {
  id: string
  store_id: string
  grid_cols: number
  grid_rows: number
  entrance_position: { col: number; row: number }
  checkout_position: { col: number; row: number }
  blocks: StoreMapBlock[]
  updated_at: string
  updated_by_household_id: string | null
}

export interface StoreMapBlock {
  section_id: string
  col: number
  row: number
  width: number
  height: number
}

export interface DefaultStoreLayout {
  id: string
  store_id: string
  section_id: string
  walk_order: number
  created_at: string
  created_by_household_id: string | null
}

export interface HouseholdStoreLayout {
  id: string
  household_id: string
  store_id: string
  section_id: string
  walk_order: number
  created_at: string
}

export interface HouseholdStore {
  id: string
  household_id: string
  store_id: string
  is_favorite: boolean
  added_at: string
}

export interface Item {
  id: string
  household_id: string
  name: string
  section_id: string | null
  times_purchased: number
  is_confirmed: boolean
  created_at: string
}

export interface ShoppingList {
  id: string
  household_id: string
  name: string
  store_id: string | null
  is_template: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ListItem {
  id: string
  list_id: string
  item_id: string
  quantity: string
  is_checked: boolean
  checked_at: string | null
  sort_override: number | null
  created_at: string
}

export interface WalkOrder {
  section_id: string
  walk_order: number
}

export interface ListItemWithDetails extends ListItem {
  item: Item
}

export interface GroupedItems {
  sectionId: string
  walkOrder: number
  items: ListItemWithDetails[]
}
