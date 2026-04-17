export type LocationType = 'SHOP' | 'YARD' | 'DROP_YARD' | 'WAREHOUSE' | 'OFFICE' | 'TERMINAL';

export interface Location {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  contact_name: string | null;
  timezone: string | null;
  operating_hours: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
  code: string | null;
  location_type: LocationType | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  // nested (detail only)
  bins?: LocationBin[];
  users?: unknown[];
  supply_rules?: unknown[];
}

export interface LocationListItem {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  code: string | null;
  location_type: LocationType | null;
  active: boolean;
  timezone: string | null;
  contact_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface LocationListResponse {
  data: LocationListItem[];
  meta: { page: number; pageSize: number; total: number };
}

export interface LocationFormValue {
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  contact_name?: string;
  timezone?: string;
  code?: string;
  location_type?: LocationType | null;
  active?: boolean;
}

// ─── Location Bins ──────────────────────────────────────────────────────────

export type BinType = 'SHELF' | 'RACK' | 'FLOOR' | 'CABINET' | 'FREEZER' | 'OUTDOOR';

export interface LocationBin {
  id: string;
  tenant_id: string;
  location_id: string;
  bin_code: string;
  bin_name: string | null;
  bin_type: BinType | null;
  zone: string | null;
  aisle: string | null;
  shelf: string | null;
  position: string | null;
  capacity_notes: string | null;
  active: boolean;
  inventory_count?: number;
  created_at: string;
  updated_at: string;
}

export interface BinFormValue {
  bin_code: string;
  bin_name?: string | null;
  bin_type?: BinType | null;
  zone?: string | null;
  aisle?: string | null;
  shelf?: string | null;
  position?: string | null;
  capacity_notes?: string | null;
  active?: boolean;
}

export interface BulkBinPayload {
  pattern?: string;
  zone?: string;
  rows?: string[];
  bin_type?: BinType | null;
}
