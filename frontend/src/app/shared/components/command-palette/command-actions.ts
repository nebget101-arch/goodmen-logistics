/**
 * FN-1335 — canonical action list for the command palette.
 *
 * Each entry maps to a route the user can jump to via Ctrl/Cmd+K. The palette
 * filters this list by `tab` (permission) and `featureFlag` (plan gate) before
 * rendering, so unauthorized roles never see entries they cannot reach.
 */
export interface CommandAction {
  label: string;
  hint?: string;
  /** Material Symbols Outlined icon name. */
  icon: string;
  /** Router path the action navigates to. */
  path: string;
  /** Optional query params appended on navigate. */
  queryParams?: Record<string, string>;
  /** Permission tab key from access-control.model TAB_PERMISSIONS. */
  tab?: string;
  /** Optional plan-gated feature flag. */
  featureFlag?: string;
}

/**
 * Priority routes + actions surfaced ahead of generic navigation entries.
 * Order is the order they appear in the palette's "Quick Actions" group.
 */
export const COMMAND_ACTIONS: CommandAction[] = [
  { label: 'Drivers',  hint: 'Manage drivers, qualifications, DQF', icon: 'badge',          path: '/drivers',  tab: 'drivers'  },
  { label: 'Vehicles', hint: 'Trucks & maintenance status',         icon: 'local_shipping', path: '/vehicles', tab: 'vehicles' },
  { label: 'Loads',    hint: 'Dispatch loads & assign drivers',     icon: 'route',          path: '/loads',    tab: 'loads'    },
  { label: 'HOS',      hint: 'Hours-of-service insights',           icon: 'schedule',       path: '/hos',      tab: 'hos'      },
  { label: 'Audit',    hint: 'Compliance audit workspace',          icon: 'gavel',          path: '/audit',    tab: 'audit'    },
  { label: 'Reports',  hint: 'Operational reports & analytics',     icon: 'analytics',      path: '/reports',  tab: 'reports'  },
  { label: 'Roadside', hint: 'Roadside AI assistant',               icon: 'emergency_home', path: '/roadside', tab: 'roadside' },
  { label: 'Generate Audit Report', hint: 'Export-ready compliance packet', icon: 'description', path: '/audit', tab: 'audit' },
];

/** Set of priority paths — used to dedupe against generic nav-link entries. */
export const COMMAND_ACTION_PATHS: ReadonlySet<string> = new Set(
  COMMAND_ACTIONS.map(a => a.path),
);
