import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import {
  sanitizeHidden,
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
 * The optional `data.layout.hidden` array (FN-1337) carries widgets the user
 * has dismissed; the server tolerates absence and treats it as `[]`.
 * `data.is_default=true` means the server returned the role default (no row
 * persisted yet); `false` means the user has saved an override.
 */
interface LayoutEnvelope {
  success: boolean;
  data: {
    layout: { cards?: unknown; hidden?: unknown };
    is_default: boolean;
    role: string;
    updated_at?: string | null;
  };
}

export interface DashboardLayout {
  widgets: WidgetId[];
  hidden: WidgetId[];
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

  saveLayout(widgets: WidgetId[], hidden: WidgetId[] = []): Observable<DashboardLayout> {
    return this.http
      .put<LayoutEnvelope>(this.endpoint, {
        cards: sanitizeLayout(widgets),
        hidden: sanitizeHidden(hidden),
      })
      .pipe(map((res) => unwrap(res)));
  }

  resetLayout(): Observable<DashboardLayout> {
    return this.http
      .delete<LayoutEnvelope>(this.endpoint)
      .pipe(map((res) => unwrap(res)));
  }
}

function unwrap(res: LayoutEnvelope): DashboardLayout {
  const data = res?.data;
  return {
    widgets: sanitizeLayout(data?.layout?.cards),
    hidden: sanitizeHidden(data?.layout?.hidden),
    isDefault: !!data?.is_default,
    role: typeof data?.role === 'string' ? data.role : '',
  };
}
