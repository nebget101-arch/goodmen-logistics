/**
 * Central nav config for sidebar. Each item is shown only if user has required permission (tab key).
 * Used by AppComponent to render menu dynamically.
 */
export interface NavLink {
  path: string;
  label: string;
  icon?: string;
  /** Permission tab key (see TAB_PERMISSIONS in access-control.model) */
  tab: string;
  /** Optional plan-gated feature key (handled by access-control feature map). */
  featureFlag?: string;
  /** Optional: only show for specific roles (e.g. dispatch sees "Drivers" as dispatch view). */
  roles?: string[];
}

export interface NavSection {
  sectionLabel: string;
  sectionIcon: string;
  /** Tab permission that shows the section (if only one). */
  tab?: string;
  /** If set, section is visible when user can see ANY of these tabs. */
  tabs?: string[];
  children: NavLink[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    sectionLabel: 'Equipment',
    sectionIcon: 'deployed_code',
    tab: 'vehicles',
    children: [
      { path: '/vehicles', label: 'Trucks', tab: 'vehicles' },
      { path: '/trailers', label: 'Trailers', tab: 'vehicles' },
    ],
  },
  {
    sectionLabel: 'Safety',
    sectionIcon: 'shield_person',
    tabs: ['hos', 'drivers', 'safety_claims', 'fmcsa_safety'],
    children: [
      { path: '/hos', label: 'HOS', tab: 'hos' },
      { path: '/drivers/dqf', label: 'DQF', tab: 'drivers', roles: ['super_admin', 'admin', 'company_admin', 'safety_manager', 'safety'] },
      { path: '/safety/compliance', label: 'Compliance', tab: 'safety_claims' },
      { path: '/safety', label: 'Claims & Accidents', tab: 'safety_claims' },
      { path: '/safety/fmcsa', label: 'FMCSA Safety', tab: 'fmcsa_safety' },
      { path: '/safety/fmcsa/inspections', label: 'Inspections', tab: 'fmcsa_safety' },
      { path: '/safety/risk-scores', label: 'Driver Risk Scores', tab: 'safety_claims' },
    ],
  },
  {
    sectionLabel: 'Fleet',
    sectionIcon: 'precision_manufacturing',
    tabs: ['maintenance', 'customers'],
    children: [
      { path: '/maintenance', label: 'Maintenance', tab: 'maintenance' },
      { path: '/shop-clients', label: 'Shop Clients', tab: 'customers' },
    ],
  },
  {
    sectionLabel: 'Inventory',
    sectionIcon: 'inventory_2',
    tabs: ['parts', 'barcodes', 'receiving', 'transfers', 'sales', 'inventory_reports'],
    children: [
      { path: '/parts', label: 'Parts', tab: 'parts' },
      { path: '/barcodes', label: 'Barcode Management', tab: 'barcodes' },
      { path: '/receiving', label: 'Warehouse Receiving', tab: 'receiving' },
      { path: '/inventory-transfers', label: 'Transfers', tab: 'transfers' },
      { path: '/direct-sales', label: 'Direct Sales', tab: 'sales' },
      { path: '/inventory-reports', label: 'Reports', tab: 'inventory_reports' },
    ],
  },
  {
    sectionLabel: 'Accounting',
    sectionIcon: 'account_balance',
    tabs: ['invoices', 'settlements', 'lease_financing'],
    children: [
      { path: '/invoices', label: 'Invoices', tab: 'invoices' },
      { path: '/settlements', label: 'Settlements', tab: 'settlements' },
      { path: '/settlements/scheduled-deductions', label: 'Scheduled Payments', tab: 'settlements' },
      { path: '/settlements/equipment-owners', label: 'Equipment Owners', tab: 'settlements' },
      { path: '/finance/lease-to-own', label: 'Lease to Own', tab: 'lease_financing', featureFlag: 'lease_to_own_financing' },
      { path: '/finance/lease-to-own/dashboard', label: 'Financing Dashboard', tab: 'lease_financing', featureFlag: 'fleet_financing_dashboard' },
    ],
  },
  {
    sectionLabel: 'Fuel',
    sectionIcon: 'local_gas_station',
    tabs: ['fuel'],
    children: [
      { path: '/fuel', label: 'Overview', tab: 'fuel' },
      { path: '/fuel/transactions', label: 'Transactions', tab: 'fuel' },
      { path: '/fuel/import', label: 'Import', tab: 'fuel' },
      { path: '/fuel/history', label: 'Import History', tab: 'fuel' },
      { path: '/fuel/cards', label: 'Fuel Cards', tab: 'fuel' },
      { path: '/fuel/exceptions', label: 'Exceptions', tab: 'fuel' },
    ],
  },
  {
    sectionLabel: 'Tolls',
    sectionIcon: 'toll',
    tabs: ['tolls'],
    children: [
      { path: '/tolls', label: 'Overview', tab: 'tolls' },
      { path: '/tolls/transactions', label: 'Transactions', tab: 'tolls' },
      { path: '/tolls/import', label: 'Import', tab: 'tolls' },
      { path: '/tolls/history', label: 'Import History', tab: 'tolls' },
      { path: '/tolls/accounts', label: 'Accounts', tab: 'tolls' },
      { path: '/tolls/devices', label: 'Devices', tab: 'tolls' },
      { path: '/tolls/exceptions', label: 'Exceptions', tab: 'tolls' },
    ],
  },
  {
    sectionLabel: 'Compliance',
    sectionIcon: 'gavel',
    tabs: ['compliance'],
    children: [
      { path: '/compliance/ifta', label: 'IFTA Quarterly', tab: 'compliance' },
    ],
  },
];

/** Top-level links (no section). */
export const NAV_TOP_LINKS: NavLink[] = [
  { path: '/dashboard', label: 'Dashboard', icon: 'dashboard', tab: 'dashboard' },
  { path: '/reports', label: 'Reports', icon: 'analytics', tab: 'reports' },
  { path: '/loads', label: 'Loads', icon: 'route', tab: 'loads' },
  { path: '/dispatch-board', label: 'Dispatch Board', icon: 'calendar_view_month', tab: 'loads' },
  { path: '/roadside', label: 'Roadside AI', icon: 'emergency_home', tab: 'roadside' },
  { path: '/drivers', label: 'Drivers', icon: 'badge', tab: 'drivers' },
  { path: '/users', label: 'Users', icon: 'group', tab: 'users' },
];

/** Single link for "Add User" - shown when user has users_create. */
export const NAV_ADD_USER: NavLink = {
  path: '/users/create',
  label: 'Add User',
  icon: 'person_add',
  tab: 'users_create',
};
