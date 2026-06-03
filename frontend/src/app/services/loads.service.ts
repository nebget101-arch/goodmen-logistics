import { Injectable } from '@angular/core';
import { HttpClient, HttpParams, HttpRequest, HttpEventType } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import {
  LoadsListResponse,
  LoadDetail,
  LoadAttachment,
  LoadAttachmentType,
  LoadAiEndpointExtraction
} from '../models/load-dashboard.model';

export interface LoadFilters {
  status?: string;
  billingStatus?: string;
  dateFrom?: string;
  dateTo?: string;
  driverId?: string;
  brokerId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  /** FN-746: when true, fetches only loads with needs_review = true. */
  needsReview?: boolean;
  /** FN-762: filter by load source (e.g. 'email') — how the load was created. */
  source?: string;
  /** FN-798: smart-filter chip keys (AND'd server-side). Array or comma-joined string. */
  smartFilter?: string[] | string;
}

/** FN-798: canonical smart-filter chip keys. Must match backend SMART_FILTER_CHIPS.
 *  FN-1353: `idle_drivers` is a new chip surfaced from the AI Insights flow;
 *  backend wiring lands separately, so the count may be 0 until then. */
export const SMART_FILTER_KEYS = [
  'ai_drafts',
  'overdue',
  'high_value',
  'from_email',
  'missing_docs',
  'my_drafts',
  'idle_drivers'
] as const;
export type SmartFilterKey = typeof SMART_FILTER_KEYS[number];
export type SmartFilterCounts = Record<SmartFilterKey, number>;

export interface DriverOption {
  id: string;
  firstName: string;
  lastName: string;
  truckId?: string | null;
  trailerId?: string | null;
}

export interface EquipmentOption {
  id: string;
  unit_number: string;
  vehicle_type: string;
  status: string;
  make?: string;
  model?: string;
}

export interface UserProfile {
  id: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  email?: string;
  role?: string;
  driver_id?: string | null;
}

export interface BrokerOption {
  id: string;
  name?: string;
  display_name?: string | null;
  legal_name?: string | null;
  mc_number?: string | null;
  dot_number?: string | null;
  city?: string | null;
  state?: string | null;
  dba_name?: string | null;
  phone?: string | null;
  email?: string | null;
  street?: string | null;
  zip?: string | null;
  country?: string | null;
  credit_score?: string | number | null;
  payment_rating?: string | null;
  broker_notes?: string | null;
  is_blocked?: boolean;
  is_preferred?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class LoadsService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  listLoads(filters: LoadFilters): Observable<LoadsListResponse> {
    let params = new HttpParams();
    Object.entries(filters || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      // FN-798: `smartFilter` maps to the `smart_filter` query param;
      // arrays are joined into the comma-separated form the backend expects.
      if (key === 'smartFilter') {
        const joined = Array.isArray(value) ? value.join(',') : String(value);
        if (joined) params = params.set('smart_filter', joined);
        return;
      }
      params = params.set(key, String(value));
    });
    return this.http.get<LoadsListResponse>(`${this.baseUrl}/loads`, { params });
  }

  /** FN-798: per-chip aggregated counts for the smart-filters row. */
  getSmartFilterCounts(): Observable<{ success: boolean; data: SmartFilterCounts }> {
    return this.http.get<{ success: boolean; data: SmartFilterCounts }>(
      `${this.baseUrl}/loads/smart-filter-counts`
    );
  }

  getLoad(id: string): Observable<{ success: boolean; data: LoadDetail }> {
    return this.http.get<{ success: boolean; data: LoadDetail }>(`${this.baseUrl}/loads/${id}`);
  }

  createLoad(payload: any): Observable<{ success: boolean; data: LoadDetail }> {
    return this.http.post<{ success: boolean; data: LoadDetail }>(`${this.baseUrl}/loads`, payload);
  }

  updateLoad(id: string, payload: any): Observable<{ success: boolean; data: LoadDetail }> {
    return this.http.put<{ success: boolean; data: LoadDetail }>(`${this.baseUrl}/loads/${id}`, payload);
  }

  /**
   * FN-756: Returns a draft payload cloned from the given load.
   * Dates cleared, status=DRAFT, PO cleared, new load_number. Nothing persisted
   * until the user saves from the wizard.
   */
  cloneLoad(id: string): Observable<{ success: boolean; data: LoadDetail }> {
    return this.http.post<{ success: boolean; data: LoadDetail }>(`${this.baseUrl}/loads/${id}/clone`, {});
  }

  /**
   * FN-756: Returns a draft payload for a return-load derived from the given load.
   * Stops reversed, rate cleared, dates cleared, status=DRAFT, broker/driver/equipment kept.
   * Nothing persisted until the user saves from the wizard.
   */
  returnLoad(id: string): Observable<{ success: boolean; data: LoadDetail }> {
    return this.http.post<{ success: boolean; data: LoadDetail }>(`${this.baseUrl}/loads/${id}/return-load`, {});
  }

  uploadAttachment(loadId: string, file: File, type: LoadAttachmentType, notes?: string): Observable<{ success: boolean; data: LoadAttachment }> {
    const form = new FormData();
    form.append('file', file);
    form.append('type', type);
    if (notes) form.append('notes', notes);
    return this.http.post<{ success: boolean; data: LoadAttachment }>(`${this.baseUrl}/loads/${loadId}/attachments`, form);
  }

  /**
   * FN-881 — same endpoint as `uploadAttachment` but streams upload progress via
   * `HttpRequest(reportProgress)`. Emits `{ progress }` during the upload and a
   * final `{ progress: 100, result }` when the server responds.
   */
  uploadAttachmentWithProgress(
    loadId: string,
    file: File,
    type: LoadAttachmentType,
    notes?: string,
  ): Observable<{ progress: number; result: { success: boolean; data: LoadAttachment } | null }> {
    const form = new FormData();
    form.append('file', file);
    form.append('type', type);
    if (notes) form.append('notes', notes);

    const req = new HttpRequest<FormData>(
      'POST',
      `${this.baseUrl}/loads/${loadId}/attachments`,
      form,
      { reportProgress: true },
    );

    return this.http.request<{ success: boolean; data: LoadAttachment }>(req).pipe(
      map((event) => {
        if (event.type === HttpEventType.UploadProgress) {
          const progress = event.total
            ? Math.round((100 * event.loaded) / event.total)
            : 0;
          return { progress, result: null };
        }
        if (event.type === HttpEventType.Response) {
          return { progress: 100, result: event.body };
        }
        return { progress: 0, result: null };
      }),
    );
  }

  getAttachments(loadId: string): Observable<{ success: boolean; data: LoadAttachment[] }> {
    return this.http.get<{ success: boolean; data: LoadAttachment[] }>(`${this.baseUrl}/loads/${loadId}/attachments`);
  }

  deleteAttachment(loadId: string, attachmentId: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.baseUrl}/loads/${loadId}/attachments/${attachmentId}`);
  }

  updateAttachment(
    loadId: string,
    attachmentId: string,
    file?: File,
    type?: LoadAttachmentType,
    notes?: string | null
  ): Observable<{ success: boolean; data: LoadAttachment }> {
    const form = new FormData();
    if (file) form.append('file', file);
    if (type) form.append('type', type);
    if (notes !== undefined) form.append('notes', notes ?? '');
    return this.http.put<{ success: boolean; data: LoadAttachment }>(
      `${this.baseUrl}/loads/${loadId}/attachments/${attachmentId}`,
      form
    );
  }

  getActiveDrivers(): Observable<DriverOption[]> {
    return this.http.get<DriverOption[]>(`${this.baseUrl}/drivers`, { params: { status: 'active' } });
  }

  getEquipment(type: 'truck' | 'trailer'): Observable<{ success: boolean; data: EquipmentOption[] }> {
    return this.http.get<{ success: boolean; data: EquipmentOption[] }>(`${this.baseUrl}/equipment`, { params: { type, status: 'active' } });
  }

  getCurrentUser(): Observable<{ success: boolean; data: UserProfile }> {
    return this.http.get<{ success: boolean; data: UserProfile }>(`${this.baseUrl}/users/me`);
  }

  lookupZip(zip: string): Observable<{ success: boolean; data: { zip: string; city: string; state: string; lat?: number; lon?: number } }> {
    return this.http.get<{ success: boolean; data: { zip: string; city: string; state: string; lat?: number; lon?: number } }>(`${this.baseUrl}/geo/zip/${encodeURIComponent(zip)}`);
  }

  /** Get route geometry (GeoJSON coordinates) between waypoints via backend OSRM proxy. */
  getRouteGeometry(waypoints: { lat: number; lon: number }[]): Observable<{ coordinates: [number, number][] } | null> {
    if (waypoints.length < 2) return of(null);
    const waypointsParam = waypoints.map((w) => `${w.lon},${w.lat}`).join(';');
    return this.http.get<{ success: boolean; data?: { coordinates: [number, number][] } }>(`${this.baseUrl}/geo/route`, {
      params: { waypoints: waypointsParam }
    }).pipe(
      map((res) => (res?.data?.coordinates?.length ? res.data : null)),
      catchError(() => of(null))
    );
  }

  getBrokers(search?: string, page = 1, pageSize = 50): Observable<{ success: boolean; data: BrokerOption[]; meta?: { total: number } }> {
    let params = new HttpParams().set('page', String(page)).set('pageSize', String(pageSize));
    if (search != null && search !== '') {
      params = params.set('q', search);
    }
    return this.http.get<{ success: boolean; data: BrokerOption[]; meta?: { total: number } }>(`${this.baseUrl}/brokers`, { params });
  }

  createBroker(payload: Partial<{
    legal_name: string;
    companyName: string;
    dba_name: string;
    mc_number: string;
    dot_number: string;
    phone: string;
    email: string;
    street: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    country: string;
    authority_type: string;
    status: string;
    notes: string;
    broker_notes: string;
    credit_score: string | number;
    payment_rating: string;
    is_blocked: boolean;
    is_preferred: boolean;
  }>): Observable<{ success: boolean; data: BrokerOption }> {
    const body: any = { ...payload };
    if (payload?.companyName && !body.legal_name) body.legal_name = payload.companyName;
    return this.http.post<{ success: boolean; data: BrokerOption }>(`${this.baseUrl}/brokers`, body);
  }

  saveBrokerOverride(payload: Partial<{
    broker_id: string;
    brokerId: string;
    credit_score: string | number;
    payment_rating: string;
    broker_notes: string;
    notes: string;
    is_blocked: boolean;
    is_preferred: boolean;
  }>): Observable<{ success: boolean; data: BrokerOption }> {
    return this.http.post<{ success: boolean; data: BrokerOption }>(`${this.baseUrl}/brokers/overrides`, payload);
  }

  bulkUploadRateConfirmations(files: File[]): Observable<{ success: boolean; results: Array<{ success: boolean; data?: LoadDetail; error?: string; filename: string }> }> {
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    return this.http.post<{ success: boolean; results: Array<{ success: boolean; data?: LoadDetail; error?: string; filename: string }> }>(
      `${this.baseUrl}/loads/bulk-rate-confirmations`,
      form
    );
  }

  approveDraft(loadId: string, body: Record<string, unknown> = {}): Observable<{ success: boolean; data: LoadDetail }> {
    return this.http.patch<{ success: boolean; data: LoadDetail }>(`${this.baseUrl}/loads/${loadId}/approve-draft`, body);
  }

  deleteDraftLoad(loadId: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.baseUrl}/loads/${loadId}`);
  }

  /**
   * FN-768: Apply the same field changes to many loads in a single transaction.
   * Allowed keys on `changes`: status, billingStatus, driverId, truckId.
   */
  bulkUpdate(ids: string[], changes: {
    status?: string;
    billingStatus?: string;
    driverId?: string | null;
    truckId?: string | null;
  }): Observable<{ success: boolean; updated: number }> {
    return this.http.post<{ success: boolean; updated: number }>(
      `${this.baseUrl}/loads/bulk-update`,
      { ids, changes }
    );
  }

  /** FN-768: Delete multiple DRAFT loads transactionally; rejects non-DRAFT rows. */
  bulkDeleteDrafts(ids: string[]): Observable<{ success: boolean; deleted: number }> {
    return this.http.post<{ success: boolean; deleted: number }>(
      `${this.baseUrl}/loads/bulk-delete-drafts`,
      { ids }
    );
  }

  aiExtractFromPdf(file: File): Observable<{ success: boolean; data: LoadAiEndpointExtraction }> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<{ success: boolean; data: LoadAiEndpointExtraction }>(
      `${this.baseUrl}/loads/ai-extract`,
      form
    );
  }

  // FN-1439: AI-ranked driver candidates for an unassigned load.
  // Backend route (FN-1438) aggregates load + candidate-driver state and
  // proxies to the AI service (FN-1437); top 5 with positive HOS only.
  recommendDriver(loadId: string): Observable<RecommendDriverResponse> {
    return this.http.post<RecommendDriverResponse>(
      `${this.baseUrl}/loads/${loadId}/recommend-driver`,
      {}
    );
  }

  /**
   * FN-795: Fetch the AI insights list for the Intelligence Panel.
   * Maps the backend response (FN-793) — which uses `insights` / `message` /
   * `action_url` / `action_label` — into the UI `AiInsight` shape consumed by
   * the Intelligence Panel.
   */
  getAiInsights(period: string): Observable<{ success: boolean; data: AiInsight[] }> {
    const resolvedPeriod = period || 'all';
    const params = new HttpParams().set('period', resolvedPeriod);
    return this.http
      .get<AiInsightsResponse>(`${this.baseUrl}/loads/ai-insights`, { params })
      .pipe(
        map((res) => ({
          success: !!res?.success,
          data: Array.isArray(res?.insights)
            ? res.insights.map((it, i) => ({
                id: `${it.type}-${resolvedPeriod}-${i}`,
                type: it.type,
                severity: it.severity,
                title: it.message,
                href: it.action_url,
              }))
            : [],
        })),
        catchError(() => of({ success: false, data: [] as AiInsight[] }))
      );
  }
}

/**
 * FN-793 backend contract for `/api/loads/ai-insights`.
 * Source: backend/packages/goodmen-shared/routes/loads.js (~L2370–2470).
 */
export type AiInsightSeverity = 'critical' | 'warn' | 'info';
export type AiInsightType =
  | 'drafts_ready'
  | 'overdue'
  | 'rate_anomaly'
  | 'missing_documents'
  | 'driver_idle'
  | 'high_margin'
  | 'low_margin';

interface AiInsightApiItem {
  type: AiInsightType;
  severity: AiInsightSeverity;
  count: number;
  message: string;
  action_url: string;
  action_label: string;
}

interface AiInsightsResponse {
  success: boolean;
  insights: AiInsightApiItem[];
}

/** Mapped UI shape consumed by `IntelligenceInsightsComponent`. */
export interface AiInsight {
  id: string;
  type: AiInsightType;
  severity: AiInsightSeverity;
  title: string;
  href: string;
}

/**
 * FN-1439 — Response shape for `POST /api/loads/:id/recommend-driver`.
 * Mirrors the AI-service contract (see FN-1431 story doc).
 */
export interface RecommendDriverCandidate {
  driverId: string;
  name?: string;
  score: number;
  rationale: string;
  hosRemaining: number;
  distanceMiles: number;
  equipmentMatch: boolean;
  lastLoadWithCustomer?: string | null;
}

export interface RecommendDriverResponse {
  success: boolean;
  candidates: RecommendDriverCandidate[];
  reasoning?: string;
}
