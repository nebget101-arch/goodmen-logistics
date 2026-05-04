import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { sanitizeLayout, WidgetId } from '../components/control-center/role-layouts';

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
}

function unwrap(res: LayoutEnvelope): DashboardLayout {
  const data = res?.data;
  return {
    widgets: sanitizeLayout(data?.layout?.cards),
    isDefault: !!data?.is_default,
    role: typeof data?.role === 'string' ? data.role : '',
  };
}
