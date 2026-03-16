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

export interface AccessSubscriptionPlan {
  id: string;
  name?: string;
  tagline?: string;
  description?: string;
  priceLabel?: string;
  includedUsers?: number;
  additionalUserPriceUsd?: number;
  includedRoles?: string[];
  includedPages?: string[];
  features?: string[];
}

export interface UserAccess {
  user: AccessUser;
  roles: string[];
  permissions: string[];
  /**
   * Optional scoped permission map from backend.
   * Example: { 'invoices.view': ['own', 'location:abc123'] }
   */
  permissionScopes?: Record<string, string[]>;
  locations: AccessLocation[];
  tenantId?: string | null;
  tenantName?: string | null;
  subscriptionPlanId?: string | null;
  subscriptionPlan?: AccessSubscriptionPlan | null;
}

/**
 * Canonical role constants used by frontend RBAC checks.
 * Keep additive/backward-compatible with legacy role values.
 */
export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  COMPANY_ADMIN: 'company_admin',
  DISPATCHER: 'dispatcher',
  SAFETY_MANAGER: 'safety_manager',
  ACCOUNTING: 'accounting',
  SHOP_MANAGER: 'shop_manager',
  SHOP_CLERK: 'shop_clerk',
  TECHNICIAN: 'technician',
  PARTS_MANAGER: 'parts_manager',
  DRIVER: 'driver',
  CUSTOMER: 'customer',
} as const;

export type RoleCode = typeof ROLES[keyof typeof ROLES];

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
  ROADSIDE_VIEW: 'roadside.view',
  ROADSIDE_MANAGE: 'roadside.manage',
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

  // Shop clerk / shop operations
  // Work orders — granular
  WORK_ORDERS_ASSIGN: 'work_orders.assign',
  WORK_ORDERS_APPROVE: 'work_orders.approve',
  WORK_ORDERS_CLOSE: 'work_orders.close',

  // Work order lines
  WORK_ORDER_LINES_VIEW: 'work_order_lines.view',
  WORK_ORDER_LINES_CREATE: 'work_order_lines.create',
  WORK_ORDER_LINES_EDIT: 'work_order_lines.edit',

  // Estimates
  ESTIMATES_VIEW: 'estimates.view',
  ESTIMATES_CREATE: 'estimates.create',
  ESTIMATES_EDIT: 'estimates.edit',
  ESTIMATES_CONVERT: 'estimates.convert',
  ESTIMATES_APPROVE: 'estimates.approve',

  // Appointments
  APPOINTMENTS_VIEW: 'appointments.view',
  APPOINTMENTS_CREATE: 'appointments.create',
  APPOINTMENTS_EDIT: 'appointments.edit',

  // Invoice finalization (separate from view/create/edit)
  INVOICES_POST: 'invoices.post',
  INVOICES_VOID: 'invoices.void',

  // Payments
  PAYMENTS_VIEW: 'payments.view',
  PAYMENTS_CREATE: 'payments.create',
  PAYMENTS_REFUND: 'payments.refund',

  // Documents
  DOCUMENTS_VIEW: 'documents.view',
  DOCUMENTS_UPLOAD: 'documents.upload',

  // Discounts
  DISCOUNTS_APPROVE: 'discounts.approve',

  // Shop reports
  REPORTS_SHOP: 'reports.shop',

  // Customers / vehicles explicit create
  CUSTOMERS_CREATE: 'customers.create',
  VEHICLES_CREATE: 'vehicles.create',

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

  // Fuel import module
  FUEL_VIEW: 'fuel.view',
  FUEL_IMPORT: 'fuel.import',
  FUEL_CARDS_MANAGE: 'fuel.cards.manage',
  FUEL_TRANSACTIONS_EDIT: 'fuel.transactions.edit',
  FUEL_EXCEPTIONS_RESOLVE: 'fuel.exceptions.resolve',
  FUEL_REPORTS_VIEW: 'fuel.reports.view',

  // Toll import module
  TOLLS_VIEW: 'tolls.view',
  TOLLS_IMPORT: 'tolls.import',
  TOLLS_ACCOUNTS_MANAGE: 'tolls.accounts.manage',
  TOLLS_TRANSACTIONS_EDIT: 'tolls.transactions.edit',
  TOLLS_EXCEPTIONS_RESOLVE: 'tolls.exceptions.resolve',
  TOLLS_REPORTS_VIEW: 'tolls.reports.view',
} as const;

export type PermissionCode = typeof PERMISSIONS[keyof typeof PERMISSIONS];

/**
 * Map from sidebar "tab" / feature key to required permission(s).
 * Any of the listed permissions grants visibility.
 */
export const TAB_PERMISSIONS: Record<string, string[]> = {
  dashboard: [PERMISSIONS.DASHBOARD_VIEW],
  reports: [PERMISSIONS.REPORTS_VIEW, PERMISSIONS.REPORTS_SHOP],
  loads: [PERMISSIONS.LOADS_VIEW],
  drivers: [PERMISSIONS.DRIVERS_VIEW],
  vehicles: [PERMISSIONS.VEHICLES_VIEW],
  hos: [PERMISSIONS.HOS_VIEW],
  audit: [PERMISSIONS.AUDIT_VIEW],
  maintenance: [PERMISSIONS.MAINTENANCE_VIEW, PERMISSIONS.WORK_ORDERS_VIEW],
  roadside: [PERMISSIONS.ROADSIDE_VIEW, PERMISSIONS.ROADSIDE_MANAGE],
  customers: [PERMISSIONS.CUSTOMERS_VIEW],
  parts: [PERMISSIONS.PARTS_VIEW, PERMISSIONS.INVENTORY_VIEW],
  barcodes: [PERMISSIONS.BARCODES_VIEW],
  receiving: [PERMISSIONS.RECEIVING_VIEW, PERMISSIONS.PARTS_RECEIVE],
  transfers: [PERMISSIONS.INVENTORY_TRANSFER, PERMISSIONS.INVENTORY_ADJUST],
  sales: [PERMISSIONS.SALES_VIEW],
  inventory_reports: [PERMISSIONS.INVENTORY_REPORTS_VIEW, PERMISSIONS.PARTS_VIEW],
  invoices: [PERMISSIONS.INVOICES_VIEW],
  settlements: [PERMISSIONS.SETTLEMENTS_VIEW],
  users: [PERMISSIONS.USERS_VIEW, PERMISSIONS.USERS_CREATE, PERMISSIONS.USERS_EDIT, PERMISSIONS.ROLES_MANAGE, PERMISSIONS.ACCESS_ADMIN],
  users_create: [PERMISSIONS.USERS_CREATE, PERMISSIONS.USERS_VIEW],
  fuel: [PERMISSIONS.FUEL_VIEW, PERMISSIONS.FUEL_IMPORT, PERMISSIONS.FUEL_CARDS_MANAGE, PERMISSIONS.FUEL_REPORTS_VIEW],
  tolls: [PERMISSIONS.TOLLS_VIEW, PERMISSIONS.TOLLS_IMPORT, PERMISSIONS.TOLLS_ACCOUNTS_MANAGE, PERMISSIONS.TOLLS_REPORTS_VIEW],
};
