/**
 * RBAC role options for admin user creation.
 * Maps role codes to display labels and optional group.
 */
export interface RbacRoleOption {
  value: string;
  label: string;
  group: 'system' | 'carrier' | 'shop' | 'parts' | 'cross' | 'future';
  description?: string;
}

export const RBAC_ROLES: RbacRoleOption[] = [
  { value: 'super_admin', label: 'Super Admin', group: 'system', description: 'Full system control across all modules and entities.' },
  { value: 'executive_read_only', label: 'Executive (Read Only)', group: 'system', description: 'Read-only leadership visibility into operational and reporting views.' },
  { value: 'dispatch_manager', label: 'Dispatch Manager', group: 'carrier', description: 'Manages dispatch operations, loads, drivers, and fleet coordination.' },
  { value: 'dispatcher', label: 'Dispatcher', group: 'carrier', description: 'Works loads, dispatch board activity, and assigned fleet workflows.' },
  { value: 'safety_manager', label: 'Safety Manager', group: 'carrier', description: 'Oversees compliance, DQF, HOS, and safety review workflows.' },
  { value: 'carrier_accountant', label: 'Carrier Accountant', group: 'carrier', description: 'Handles invoices, settlements, and carrier-side accounting workflows.' },
  { value: 'shop_manager', label: 'Shop Manager', group: 'shop', description: 'Runs maintenance operations, work orders, and shop administration.' },
  { value: 'service_writer', label: 'Service Writer', group: 'shop', description: 'Coordinates service intake, work orders, and service-side invoicing.' },
  { value: 'mechanic', label: 'Mechanic', group: 'shop', description: 'Executes maintenance work orders and shop-floor operational tasks.' },
  { value: 'parts_manager', label: 'Parts Manager', group: 'parts', description: 'Manages parts, receiving, transfers, and inventory control.' },
  { value: 'parts_clerk', label: 'Parts Clerk', group: 'parts', description: 'Supports receiving, transfers, and front-counter parts workflows.' },
  { value: 'inventory_auditor', label: 'Inventory Auditor', group: 'parts', description: 'Reviews inventory and reporting without operational edit access.' },
  { value: 'company_accountant', label: 'Company Accountant', group: 'cross', description: 'Supports broader accounting visibility across company operations.' },
  { value: 'driver', label: 'Driver', group: 'future', description: 'Driver-focused portal access for assigned operational activity.' },
  { value: 'customer', label: 'Customer', group: 'future', description: 'Customer-facing portal role for future self-service workflows.' },
  { value: 'admin', label: 'Admin (legacy)', group: 'system', description: 'Legacy admin compatibility role mapped to full administrative access.' },
];

export function getVisibleRbacRolesForPlan(planId: string | null | undefined): RbacRoleOption[] {
  const normalizedPlanId = String(planId || '').trim().toLowerCase();
  const isBasicOrMultiMcPlan = normalizedPlanId === 'basic' || normalizedPlanId === 'multi_mc';

  if (!isBasicOrMultiMcPlan) {
    return RBAC_ROLES;
  }

  return RBAC_ROLES.filter((role) => {
    if (role.group === 'shop' || role.group === 'parts') return false;
    if (role.value === 'customer' || role.value === 'admin') return false;
    return true;
  });
}
