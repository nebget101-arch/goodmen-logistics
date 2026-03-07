/**
 * RBAC role options for admin user creation.
 * Maps role codes to display labels and optional group.
 */
export interface RbacRoleOption {
  value: string;
  label: string;
  group: 'system' | 'carrier' | 'shop' | 'parts' | 'cross' | 'future';
}

export const RBAC_ROLES: RbacRoleOption[] = [
  { value: 'super_admin', label: 'Super Admin', group: 'system' },
  { value: 'executive_read_only', label: 'Executive (Read Only)', group: 'system' },
  { value: 'dispatch_manager', label: 'Dispatch Manager', group: 'carrier' },
  { value: 'dispatcher', label: 'Dispatcher', group: 'carrier' },
  { value: 'safety_manager', label: 'Safety Manager', group: 'carrier' },
  { value: 'carrier_accountant', label: 'Carrier Accountant', group: 'carrier' },
  { value: 'shop_manager', label: 'Shop Manager', group: 'shop' },
  { value: 'service_writer', label: 'Service Writer', group: 'shop' },
  { value: 'mechanic', label: 'Mechanic', group: 'shop' },
  { value: 'parts_manager', label: 'Parts Manager', group: 'parts' },
  { value: 'parts_clerk', label: 'Parts Clerk', group: 'parts' },
  { value: 'inventory_auditor', label: 'Inventory Auditor', group: 'parts' },
  { value: 'company_accountant', label: 'Company Accountant', group: 'cross' },
  { value: 'driver', label: 'Driver', group: 'future' },
  { value: 'customer', label: 'Customer', group: 'future' },
  { value: 'admin', label: 'Admin (legacy)', group: 'system' },
];
