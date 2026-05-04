import type { QuickActionDef } from './quick-actions/quick-actions.component';

export type WidgetId =
  | 'daily-briefing'
  | 'smart-alerts'
  | 'predictive-insights'
  | 'quick-actions';

export type RoleKey = 'dispatcher' | 'safety' | 'maintenance' | 'owner';

export const ALL_WIDGET_IDS: readonly WidgetId[] = [
  'daily-briefing',
  'smart-alerts',
  'predictive-insights',
  'quick-actions',
];

export const FALLBACK_ROLE: RoleKey = 'dispatcher';

/**
 * Role default layouts as defined in docs/stories/FN-1130.md (Role Defaults).
 * Order is the rendered top-to-bottom card order.
 */
export const ROLE_DEFAULT_LAYOUTS: Readonly<Record<RoleKey, readonly WidgetId[]>> = {
  dispatcher: ['daily-briefing', 'smart-alerts', 'predictive-insights', 'quick-actions'],
  safety: ['daily-briefing', 'smart-alerts', 'predictive-insights', 'quick-actions'],
  maintenance: ['daily-briefing', 'smart-alerts', 'predictive-insights', 'quick-actions'],
  owner: ['daily-briefing', 'predictive-insights', 'smart-alerts'],
};

/**
 * Per-role contextual quick actions surfaced by the top-level Quick Actions card.
 * Cards inside Smart Alerts / Predictive Insights remain row-scoped (FN-1169) and
 * are unrelated to this list.
 */
export const ROLE_QUICK_ACTIONS: Readonly<Record<RoleKey, readonly QuickActionDef[]>> = {
  dispatcher: [
    { id: 'create-load', label: 'Create load', icon: '+', routerLink: ['/loads'], variant: 'primary' },
    { id: 'dispatch-board', label: 'Dispatch board', icon: '⇄', routerLink: ['/dispatch-board'] },
    { id: 'drivers', label: 'Drivers', icon: '◐', routerLink: ['/drivers'] },
  ],
  safety: [
    { id: 'hos', label: 'HOS violations', icon: '!', routerLink: ['/hos'], variant: 'primary' },
    { id: 'dqf', label: 'DQF overview', icon: '◎', routerLink: ['/drivers/dqf'] },
    { id: 'roadside', label: 'Roadside', icon: '◇', routerLink: ['/roadside'] },
  ],
  maintenance: [
    { id: 'work-order', label: 'Work orders', icon: '⚙', routerLink: ['/work-order'], variant: 'primary' },
    { id: 'vehicles', label: 'Vehicles', icon: '▣', routerLink: ['/vehicles'] },
    { id: 'parts', label: 'Parts catalog', icon: '⚒', routerLink: ['/parts'] },
  ],
  owner: [
    { id: 'billing', label: 'Billing', icon: '$', routerLink: ['/billing'], variant: 'primary' },
    { id: 'reports', label: 'Reports', icon: '◫', routerLink: ['/reports'] },
  ],
};

/**
 * Mirrors the server-side aliases in
 * backend/microservices/auth-users-service/services/layout-store.js so the
 * client-side fallback path matches the canonical role keys the server uses.
 */
const ROLE_ALIASES: Readonly<Record<string, RoleKey>> = {
  dispatcher: 'dispatcher',
  dispatch: 'dispatcher',
  safety: 'safety',
  safety_manager: 'safety',
  maintenance: 'maintenance',
  mechanic: 'maintenance',
  technician: 'maintenance',
  owner: 'owner',
  admin: 'owner',
  super_admin: 'owner',
  platform_admin: 'owner',
  accounting: 'owner',
};

export function normalizeRole(role: string | null | undefined): RoleKey {
  const key = (role || '').trim().toLowerCase();
  return ROLE_ALIASES[key] ?? FALLBACK_ROLE;
}

export function defaultLayoutForRole(role: string | null | undefined): WidgetId[] {
  return [...ROLE_DEFAULT_LAYOUTS[normalizeRole(role)]];
}

export function quickActionsForRole(role: string | null | undefined): QuickActionDef[] {
  return [...ROLE_QUICK_ACTIONS[normalizeRole(role)]];
}

/**
 * Drop unknown ids and de-duplicate while preserving order. Used to sanitize
 * server-persisted layouts before render.
 */
export function sanitizeLayout(widgets: unknown): WidgetId[] {
  if (!Array.isArray(widgets)) return [];
  const seen = new Set<WidgetId>();
  const out: WidgetId[] = [];
  for (const id of widgets) {
    if (typeof id !== 'string') continue;
    if (!ALL_WIDGET_IDS.includes(id as WidgetId)) continue;
    if (seen.has(id as WidgetId)) continue;
    seen.add(id as WidgetId);
    out.push(id as WidgetId);
  }
  return out;
}
