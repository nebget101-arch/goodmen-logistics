import type { QuickActionDef } from './quick-actions/quick-actions.component';

export type WidgetId =
  | 'daily-briefing'
  | 'action-queue'
  | 'predictive-insights'
  | 'quick-actions';

export type RoleKey = 'dispatcher' | 'safety' | 'maintenance' | 'owner';

export const ALL_WIDGET_IDS: readonly WidgetId[] = [
  'daily-briefing',
  'action-queue',
  'predictive-insights',
  'quick-actions',
];

/**
 * Legacy widget ids that map to a current widget. Persisted layouts written
 * before FN-1322 (Action Queue) used `smart-alerts`; rewrite on read so users
 * keep their card order across the rename.
 */
const LEGACY_WIDGET_ID_MAP: Readonly<Record<string, WidgetId>> = {
  'smart-alerts': 'action-queue',
};

export const FALLBACK_ROLE: RoleKey = 'dispatcher';

/**
 * Role default layouts as defined in docs/stories/FN-1130.md (Role Defaults).
 * Order is the rendered top-to-bottom card order.
 */
export const ROLE_DEFAULT_LAYOUTS: Readonly<Record<RoleKey, readonly WidgetId[]>> = {
  dispatcher: ['daily-briefing', 'action-queue', 'predictive-insights', 'quick-actions'],
  safety: ['daily-briefing', 'action-queue', 'predictive-insights', 'quick-actions'],
  maintenance: ['daily-briefing', 'action-queue', 'predictive-insights', 'quick-actions'],
  owner: ['daily-briefing', 'predictive-insights', 'action-queue'],
};

/**
 * FN-1343 — named layout presets surfaced by the Control Center settings menu.
 * Mirrors the rows seeded by the FN-1341 migration into `dashboard_layout_presets`.
 * `roleKey` is the canonical RBAC role each preset maps onto; `Compliance`
 * attaches to `safety` per the parent story (FN-1327) Schema Contract notes.
 */
export interface DashboardLayoutPreset {
  presetKey: 'owner-default' | 'dispatcher-default' | 'compliance-default';
  displayName: string;
  roleKey: RoleKey;
  widgets: WidgetId[];
}

export const LAYOUT_PRESETS: readonly DashboardLayoutPreset[] = [
  {
    presetKey: 'owner-default',
    displayName: 'Owner',
    roleKey: 'owner',
    widgets: [...ROLE_DEFAULT_LAYOUTS.owner],
  },
  {
    presetKey: 'dispatcher-default',
    displayName: 'Dispatcher',
    roleKey: 'dispatcher',
    widgets: [...ROLE_DEFAULT_LAYOUTS.dispatcher],
  },
  {
    presetKey: 'compliance-default',
    displayName: 'Compliance',
    roleKey: 'safety',
    widgets: [...ROLE_DEFAULT_LAYOUTS.safety],
  },
];

export function findPreset(
  presetKey: string | null | undefined
): DashboardLayoutPreset | undefined {
  if (!presetKey) return undefined;
  return LAYOUT_PRESETS.find((p) => p.presetKey === presetKey);
}

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
    const mapped: WidgetId | undefined =
      (LEGACY_WIDGET_ID_MAP[id] as WidgetId | undefined) ??
      (ALL_WIDGET_IDS.includes(id as WidgetId) ? (id as WidgetId) : undefined);
    if (!mapped) continue;
    if (seen.has(mapped)) continue;
    seen.add(mapped);
    out.push(mapped);
  }
  return out;
}

/**
 * Hidden cards (FN-1337): per-user dismissed widgets persisted alongside the
 * card order. Reuses the same id-mapping rules as the cards array so a legacy
 * `smart-alerts` flag survives the rename to `action-queue`.
 */
export function sanitizeHidden(hidden: unknown): WidgetId[] {
  return sanitizeLayout(hidden);
}
