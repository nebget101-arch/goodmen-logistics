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
    tabs: ['hos', 'audit', 'drivers'],
    children: [
      { path: '/hos', label: 'HOS', tab: 'hos' },
      { path: '/drivers/dqf', label: 'DQF', tab: 'drivers' },
      { path: '/audit', label: 'Audit', tab: 'audit' },
    ],
  },
  {
    sectionLabel: 'Fleet',
    sectionIcon: 'precision_manufacturing',
    tabs: ['maintenance', 'customers'],
    children: [
      { path: '/maintenance', label: 'Maintenance', tab: 'maintenance' },
      { path: '/customers', label: 'Customers', tab: 'customers' },
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
    tabs: ['invoices', 'settlements'],
    children: [
      { path: '/invoices', label: 'Invoices', tab: 'invoices' },
      { path: '/settlements', label: 'Settlements', tab: 'settlements' },
    ],
  },
];

/** Top-level links (no section). */
export const NAV_TOP_LINKS: NavLink[] = [
  { path: '/dashboard', label: 'Dashboard', icon: 'dashboard', tab: 'dashboard' },
  { path: '/loads', label: 'Loads', icon: 'route', tab: 'loads' },
  { path: '/dispatch-board', label: 'Dispatch Board', icon: 'calendar_view_month', tab: 'loads' },
  { path: '/drivers', label: 'Drivers', icon: 'badge', tab: 'drivers' },
];

/** Single link for "Add User" - shown when user has users_create. */
export const NAV_ADD_USER: NavLink = {
  path: '/users/create',
  label: 'Add User',
  icon: 'person_add',
  tab: 'users_create',
};
