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
  operating_hours: any | null;
  settings: any | null;
  code: string | null;
  location_type: LocationType | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  // nested (detail only)
  bins?: any[];
  users?: any[];
  supply_rules?: any[];
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
