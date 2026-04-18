export type LocationType = 'SHOP' | 'YARD' | 'DROP_YARD' | 'WAREHOUSE' | 'OFFICE' | 'TERMINAL';

export interface OperatingHoursDay {
  closed: boolean;
  open: string;
  close: string;
}

export interface OperatingHours {
  monday: OperatingHoursDay;
  tuesday: OperatingHoursDay;
  wednesday: OperatingHoursDay;
  thursday: OperatingHoursDay;
  friday: OperatingHoursDay;
  saturday: OperatingHoursDay;
  sunday: OperatingHoursDay;
}

export interface LocationBin {
  id: string;
  location_id: string;
  bin_code: string;
  bin_name: string | null;
  bin_type: 'SHELF' | 'RACK' | 'FLOOR' | 'CABINET' | 'FREEZER' | 'OUTDOOR';
  zone: string | null;
  aisle: string | null;
  shelf: string | null;
  position: string | null;
  capacity_notes: string | null;
  active: boolean;
  created_at: string;
}

export interface LocationUser {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  assigned_at: string;
}

export interface LocationSupplyRule {
  id: string;
  warehouse_location_id: string;
  shop_location_id: string;
  notes: string | null;
  active: boolean;
  created_at: string;
}

export interface SupplyRuleRow {
  id: string;
  warehouse_location_id: string;
  shop_location_id: string;
  warehouse_name: string;
  shop_name: string;
  is_primary_supplier: boolean;
  auto_replenish: boolean;
  delivery_days: number | null;
  notes: string | null;
  active: boolean;
  created_at: string;
}

export interface LocationDependencies {
  work_orders: number;
  inventory_items: number;
  users: number;
  vehicles: number;
}

export interface LocationListItem {
  id: string;
  name: string;
  code: string | null;
  location_type: LocationType | null;
  address: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  active: boolean;
  created_at: string;
}

export interface Location extends LocationListItem {
  zip: string | null;
  email: string | null;
  contact_name: string | null;
  timezone: string | null;
  operating_hours: OperatingHours | null;
  tenant_id: string;
  updated_at: string;
  bins?: LocationBin[];
  users?: LocationUser[];
  supply_rules?: LocationSupplyRule[];
}

export interface LocationListResponse {
  data: LocationListItem[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
  };
}

export interface LocationFormValue {
  name: string;
  code?: string;
  location_type: LocationType;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  contact_name?: string;
  timezone?: string;
  active?: boolean;
  operating_hours?: Record<string, OperatingHoursDay>;
}
