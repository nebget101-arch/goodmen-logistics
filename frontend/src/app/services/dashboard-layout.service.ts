import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import {
  DashboardLayoutPreset,
  findPreset,
  LAYOUT_PRESETS,
  sanitizeLayout,
  WidgetId,
} from '../components/control-center/role-layouts';

/**
 * Wire shape returned by FN-1172's auth-users-service routes:
 *   GET    /api/users/me/dashboard-layout   → { success, data }
 *   PUT    /api/users/me/dashboard-layout   → { success, data }
 *   DELETE /api/users/me/dashboard-layout   → { success, data }  (role default)
 *
 * The `data.layout.cards` array is the authoritative ordered widget list.
 * `data.is_default=true` means the server returned the role default (no row
 * persisted yet); `false` means the user has saved an override.
 */
interface LayoutEnvelope {
  success: boolean;
  data: {
    layout: { cards?: unknown };
    is_default: boolean;
    role: string;
    updated_at?: string | null;
  };
}

export interface DashboardLayout {
  widgets: WidgetId[];
  isDefault: boolean;
  role: string;
}

@Injectable({ providedIn: 'root' })
export class DashboardLayoutService {
  private readonly endpoint = `${environment.apiUrl}/users/me/dashboard-layout`;

  constructor(private readonly http: HttpClient) {}

  getLayout(): Observable<DashboardLayout> {
    return this.http
      .get<LayoutEnvelope>(this.endpoint)
      .pipe(map((res) => unwrap(res)));
  }

  saveLayout(widgets: WidgetId[]): Observable<DashboardLayout> {
    return this.http
      .put<LayoutEnvelope>(this.endpoint, { cards: sanitizeLayout(widgets) })
      .pipe(map((res) => unwrap(res)));
  }

  resetLayout(): Observable<DashboardLayout> {
    return this.http
      .delete<LayoutEnvelope>(this.endpoint)
      .pipe(map((res) => unwrap(res)));
  }

  /**
   * FN-1343 — list of named layout presets shown in the Control Center
   * settings menu. Backed by the `LAYOUT_PRESETS` constant for now (mirror
   * of the seeded `dashboard_layout_presets` rows from FN-1341); returned as
   * an Observable so this can swap to a server fetch later (e.g. when an
   * admin-editable preset endpoint is exposed) without touching call sites.
   */
  getPresets(): Observable<DashboardLayoutPreset[]> {
    return of(LAYOUT_PRESETS.map((p) => ({ ...p, widgets: [...p.widgets] })));
  }

  /**
   * FN-1343 — apply a named preset by persisting its widget order through
   * the existing `PUT /api/users/me/dashboard-layout` endpoint. Errors if
   * `presetKey` is unknown so callers can surface a clear message instead
   * of writing an empty layout.
   */
  applyPreset(presetKey: string): Observable<DashboardLayout> {
    const preset = findPreset(presetKey);
    if (!preset) {
      throw new Error(`Unknown layout preset: ${presetKey}`);
    }
    return this.saveLayout(preset.widgets);
  }
}

function unwrap(res: LayoutEnvelope): DashboardLayout {
  const data = res?.data;
  return {
    widgets: sanitizeLayout(data?.layout?.cards),
    isDefault: !!data?.is_default,
    role: typeof data?.role === 'string' ? data.role : '',
  };
}
