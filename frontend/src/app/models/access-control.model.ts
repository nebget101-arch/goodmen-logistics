/**
 * Frontend RBAC models.
 * Consumes a shape like: { user, roles, permissions, locations } from backend.
 */

export interface AccessLocation {
  id: string;
  name: string;
}

export interface AccessUser {
  id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  email?: string;
}

export interface UserAccess {
  user: AccessUser;
  roles: string[];
  permissions: string[];
  locations: AccessLocation[];
}

/**
 * Permission codes used across the app.
 * Backend should return a subset of these (or equivalent) per user.
 */
export const PERMISSIONS = {
  // Dashboard & reports
  DASHBOARD_VIEW: 'dashboard.view',
  REPORTS_VIEW: 'reports.view',

  // Loads / dispatch
  LOADS_VIEW: 'loads.view',
  LOADS_CREATE: 'loads.create',
  LOADS_EDIT: 'loads.edit',
  LOADS_ASSIGN: 'loads.assign',
  BROKERS_VIEW: 'brokers.view',

  // Drivers / safety
  DRIVERS_VIEW: 'drivers.view',
  DRIVERS_EDIT: 'drivers.edit',
  DQF_VIEW: 'dqf.view',
  DQF_EDIT: 'dqf.edit',
  HOS_VIEW: 'hos.view',
  AUDIT_VIEW: 'audit.view',

  // Equipment
  VEHICLES_VIEW: 'vehicles.view',
  VEHICLES_EDIT: 'vehicles.edit',

  // Fleet / maintenance
  MAINTENANCE_VIEW: 'maintenance.view',
  WORK_ORDERS_VIEW: 'work_orders.view',
  WORK_ORDERS_CREATE: 'work_orders.create',
  WORK_ORDERS_EDIT: 'work_orders.edit',
  WORK_ORDERS_FINALIZE: 'work_orders.finalize',

  // Customers
  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_EDIT: 'customers.edit',

  // Invoices / accounting
  INVOICES_VIEW: 'invoices.view',
  INVOICES_CREATE: 'invoices.create',
  INVOICES_EDIT: 'invoices.edit',
  INVOICES_FINALIZE: 'invoices.finalize',
  INVOICES_EXPORT: 'invoices.export',

  // Settlements / payroll
  SETTLEMENTS_VIEW: 'settlements.view',
  SETTLEMENTS_CREATE: 'settlements.create',
  SETTLEMENTS_EDIT: 'settlements.edit',
  SETTLEMENTS_APPROVE: 'settlements.approve',

  // Parts / inventory
  PARTS_VIEW: 'parts.view',
  PARTS_EDIT: 'parts.edit',
  PARTS_RECEIVE: 'parts.receive',
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_TRANSFER: 'inventory.transfer',
  INVENTORY_ADJUST: 'inventory.adjust',
  BARCODES_VIEW: 'barcodes.view',
  BARCODES_EDIT: 'barcodes.edit',
  RECEIVING_VIEW: 'receiving.view',
  RECEIVING_RECEIVE: 'receiving.receive',
  SALES_VIEW: 'sales.view',
  SALES_CREATE: 'sales.create',
  INVENTORY_REPORTS_VIEW: 'inventory_reports.view',

  // Users / admin
  USERS_VIEW: 'users.view',
  USERS_CREATE: 'users.create',
  USERS_EDIT: 'users.edit',
  ROLES_MANAGE: 'roles.manage',
  ACCESS_ADMIN: 'access.admin',
} as const;

export type PermissionCode = typeof PERMISSIONS[keyof typeof PERMISSIONS];

/**
 * Map from sidebar "tab" / feature key to required permission(s).
 * Any of the listed permissions grants visibility.
 */
export const TAB_PERMISSIONS: Record<string, string[]> = {
  dashboard: [PERMISSIONS.DASHBOARD_VIEW],
  loads: [PERMISSIONS.LOADS_VIEW],
  drivers: [PERMISSIONS.DRIVERS_VIEW],
  vehicles: [PERMISSIONS.VEHICLES_VIEW],
  hos: [PERMISSIONS.HOS_VIEW],
  audit: [PERMISSIONS.AUDIT_VIEW],
  maintenance: [PERMISSIONS.MAINTENANCE_VIEW, PERMISSIONS.WORK_ORDERS_VIEW],
  customers: [PERMISSIONS.CUSTOMERS_VIEW],
  parts: [PERMISSIONS.PARTS_VIEW, PERMISSIONS.INVENTORY_VIEW],
  barcodes: [PERMISSIONS.BARCODES_VIEW],
  receiving: [PERMISSIONS.RECEIVING_VIEW, PERMISSIONS.PARTS_RECEIVE],
  transfers: [PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_TRANSFER],
  sales: [PERMISSIONS.SALES_VIEW],
  inventory_reports: [PERMISSIONS.INVENTORY_REPORTS_VIEW, PERMISSIONS.PARTS_VIEW],
  invoices: [PERMISSIONS.INVOICES_VIEW],
  settlements: [PERMISSIONS.SETTLEMENTS_VIEW],
  users_create: [PERMISSIONS.USERS_CREATE, PERMISSIONS.USERS_VIEW],
};
