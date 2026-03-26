import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, timeout } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) { }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  // Locations
  getLocations(): Observable<any> {
    return this.http.get(`${this.baseUrl}/locations`);
  }

  // FMCSA company info lookup (legacy — shop clients context)
  getFmcsainfo(dot: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/shop-clients/fmcsainfo/${encodeURIComponent(dot)}`);
  }

  /**
   * FN-101/102: FMCSA carrier lookup via server-side proxy.
   * The API key never leaves the backend.
   * HTTP 404 → { found: false }
   * HTTP 503 → { found: false, error: 'lookup_unavailable' }
   * @param force  Pass true (requires admin JWT) to bypass the 1-hour cache.
   */
  fmcsaLookup(dotNumber: string, force = false): Observable<{
    found: boolean;
    dotNumber?: string;
    legalName?: string;
    dbaName?: string;
    mcNumber?: string | null;
    status?: string;
    authorityType?: string;
    phone?: string;
    city?: string;
    state?: string;
    zip?: string;
    safetyRating?: string;
    oosPercent?: number | null;
    totalDrivers?: number | null;
    totalTrucks?: number | null;
    error?: string;
  }> {
    const url = `${this.baseUrl}/fmcsa/lookup/${encodeURIComponent(dotNumber)}${
      force ? '?force=true' : ''
    }`;
    return this.http.get<any>(url);
  }

  // Customers
  getCustomers(params?: { query?: string; pageSize?: number }): Observable<any> {
    let url = `${this.baseUrl}/shop-clients`;
    const queryParams: string[] = [];
    if (params?.query) queryParams.push(`search=${encodeURIComponent(params.query)}`);
    if (params?.pageSize) queryParams.push(`pageSize=${params.pageSize}`);
    if (queryParams.length > 0) url += `?${queryParams.join('&')}`;
    return this.http.get(url);
  }

  getCustomerByDot(dot: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/shop-clients?dot=${encodeURIComponent(dot)}`);
  }

  createCustomer(customer: any): Observable<any> {
    const payload = { ...customer };
    if (!payload.company_name && payload.name) {
      payload.company_name = payload.name;
    }
    return this.http.post(`${this.baseUrl}/shop-clients`, payload);
  }

  // Users
  createUser(user: {
    username?: string;
    password: string;
    role?: string;
    roles?: string[];
    firstName?: string;
    lastName?: string;
    email?: string;
    locationIds?: string[];
  }): Observable<any> {
    const payload: any = {
      username: user.username,
      password: user.password,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
    };
    payload.role = user.roles?.[0] ?? user.role ?? 'dispatcher';
    if (user.roles?.length) payload.roles = user.roles;
    if (user.locationIds?.length) payload.locationIds = user.locationIds;
    return this.http.post(`${this.baseUrl}/users`, payload);
  }

  getTechnicians(): Observable<any> {
    return this.http.get(`${this.baseUrl}/users/technicians`);
  }

  getUserById(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/users/${id}`);
  }

  updateUser(
    id: string,
    payload: {
      username?: string;
      firstName?: string | null;
      lastName?: string | null;
      email?: string | null;
      role?: string;
      roles?: string[];
      is_active?: boolean;
    }
  ): Observable<any> {
    return this.http.put(`${this.baseUrl}/users/${id}`, payload);
  }

  setUserActive(id: string, isActive: boolean): Observable<any> {
    return this.http.patch(`${this.baseUrl}/users/${id}/status`, { is_active: isActive });
  }

  listUsers(): Observable<any> {
    return this.http.get(`${this.baseUrl}/users`);
  }

  // Multi-MC admin management
  listOperatingEntities(): Observable<any> {
    return this.http.get(`${this.baseUrl}/users/operating-entities`);
  }

  createOperatingEntity(payload: {
    name: string;
    legal_name?: string;
    dba_name?: string;
    mc_number?: string;
    dot_number?: string;
    address_line1?: string;
    city?: string;
    state?: string;
    zip_code?: string;
    entity_type?: string;
    is_active?: boolean;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/users/operating-entities`, payload);
  }

  updateOperatingEntity(entityId: string, payload: {
    name?: string;
    legal_name?: string;
    dba_name?: string;
    mc_number?: string;
    dot_number?: string;
    address_line1?: string;
    city?: string;
    state?: string;
    zip_code?: string;
    entity_type?: string;
    is_active?: boolean;
  }): Observable<any> {
    return this.http.put(`${this.baseUrl}/users/operating-entities/${entityId}`, payload);
  }

  getUserOperatingEntityAccess(userId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/users/${userId}/operating-entities`);
  }

  updateUserOperatingEntityAccess(userId: string, payload: {
    operatingEntityIds: string[];
    defaultOperatingEntityId?: string | null;
  }): Observable<any> {
    return this.http.put(`${this.baseUrl}/users/${userId}/operating-entities`, payload);
  }

  // Dashboard
  getDashboardStats(): Observable<any> {
    return this.http.get(`${this.baseUrl}/dashboard/stats`);
  }

  getAlerts(): Observable<any> {
    return this.http.get(`${this.baseUrl}/dashboard/alerts`);
  }

  // Drivers
  getDrivers(): Observable<any> {
    return this.http.get(`${this.baseUrl}/drivers`);
  }

  getDispatchDrivers(status?: string, includeAllEntities = false): Observable<any> {
    const params: any = { view: 'dispatch' };
    if (status) params.status = status;
    if (includeAllEntities) params.includeAllEntities = 'true';
    return this.http.get(`${this.baseUrl}/drivers`, { params });
  }

  getDqfDrivers(status?: string): Observable<any> {
    const params: any = { view: 'dqf' };
    if (status) params.status = status;
    return this.http.get(`${this.baseUrl}/drivers`, { params });
  }

  getDriver(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/drivers/${id}`).pipe(
      timeout(15000) // 15s so Edit modal does not spin forever if backend hangs
    );
  }

  createDriver(driver: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/drivers`, driver);
  }

  updateDriver(id: string, driver: any): Observable<any> {
    return this.http.put(`${this.baseUrl}/drivers/${id}`, driver).pipe(
      timeout(30000) // 30s so UI does not stay stuck if backend hangs
    );
  }

  deleteDriver(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/drivers/${id}`);
  }

  // Settlements (payroll)
  listSettlements(filters?: { driver_id?: string; payroll_period_id?: string; settlement_status?: string; settlement_number?: string; limit?: number; offset?: number }): Observable<any> {
    let url = `${this.baseUrl}/settlements/settlements`;
    const params = new URLSearchParams();
    if (filters?.driver_id) params.set('driver_id', filters.driver_id);
    if (filters?.payroll_period_id) params.set('payroll_period_id', filters.payroll_period_id);
    if (filters?.settlement_status) params.set('settlement_status', filters.settlement_status);
    if (filters?.settlement_number) params.set('settlement_number', filters.settlement_number);
    if (filters?.limit != null) params.set('limit', String(filters.limit));
    if (filters?.offset != null) params.set('offset', String(filters.offset));
    const qs = params.toString();
    if (qs) url += `?${qs}`;
    return this.http.get(url);
  }

  normalizeSettlementDetail(raw: any): any {
    const src = raw || {};
    const settlement = src?.settlement || src;

    const loadItems = Array.isArray(src?.load_items)
      ? src.load_items
      : (Array.isArray(settlement?.load_items) ? settlement.load_items : []);

    const adjustmentItems = Array.isArray(src?.adjustment_items)
      ? src.adjustment_items
      : (Array.isArray(settlement?.adjustment_items) ? settlement.adjustment_items : []);

    const scheduled = adjustmentItems.filter((a: any) => {
      const source = (a?.source_type || '').toLowerCase();
      return source === 'scheduled_rule' || source === 'scheduled';
    });

    const manual = adjustmentItems.filter((a: any) => {
      const source = (a?.source_type || 'manual').toLowerCase();
      return source === 'manual' || source === '';
    });

    const variable = adjustmentItems.filter((a: any) => !scheduled.includes(a) && !manual.includes(a));

    const adjustmentGroups = {
      scheduled: Array.isArray(src?.adjustment_groups?.scheduled) ? src.adjustment_groups.scheduled : scheduled,
      manual: Array.isArray(src?.adjustment_groups?.manual) ? src.adjustment_groups.manual : manual,
      variable: Array.isArray(src?.adjustment_groups?.variable) ? src.adjustment_groups.variable : variable
    };

    const normalized = {
      ...settlement,
      settlement,
      load_items: loadItems,
      adjustment_items: adjustmentItems,
      driver: src?.driver || settlement?.driver || null,
      period: src?.period || settlement?.period || null,
      primary_payee: src?.primary_payee || settlement?.primary_payee || null,
      additional_payee: src?.additional_payee || settlement?.additional_payee || null,
      adjustment_groups: adjustmentGroups
    };

    return normalized;
  }

  getSettlement(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/settlements/settlements/${id}`).pipe(
      map((res: any) => this.normalizeSettlementDetail(res))
    );
  }

  recalcSettlement(id: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/settlements/settlements/${id}/recalc`, {});
  }

  addSettlementLoad(id: string, payload: { load_id: string }): Observable<any> {
    return this.http.post(`${this.baseUrl}/settlements/settlements/${id}/loads`, payload);
  }

  removeSettlementLoad(id: string, loadItemId: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/settlements/settlements/${id}/loads/${loadItemId}`);
  }

  addSettlementAdjustment(
    id: string,
    payload: {
      item_type: string;
      source_type?: string;
      description?: string;
      amount: number;
      quantity?: number | null;
      unit_rate?: number | null;
      charge_party?: string;
      apply_to?: string;
      category_id?: string | null;
    }
  ): Observable<any> {
    return this.http.post(`${this.baseUrl}/settlements/settlements/${id}/adjustments`, payload);
  }

  removeSettlementAdjustment(id: string, adjustmentId: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/settlements/settlements/${id}/adjustments/${adjustmentId}`);
  }

  restoreSettlementAdjustment(id: string, adjustmentId: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/settlements/settlements/${id}/adjustments/${adjustmentId}/restore`, {});
  }

  approveSettlement(id: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/settlements/settlements/${id}/approve`, {});
  }

  voidSettlement(id: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/settlements/settlements/${id}/void`, {});
  }

  getSettlementPdfPayload(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/settlements/settlements/${id}/pdf-payload`);
  }

  sendSettlementEmail(
    id: string,
    payload: { to_driver?: boolean; to_additional_payee?: boolean; cc_internal?: boolean }
  ): Observable<any> {
    return this.http.post(`${this.baseUrl}/settlements/settlements/${id}/send-email`, payload);
  }

  generateSettlementPdfToR2(id: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/settlements/settlements/${id}/pdf/generate`, {});
  }

  downloadSettlementPdfBlob(id: string): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/settlements/settlements/${id}/pdf/download`, {
      responseType: 'blob'
    });
  }

  createSettlementDraft(payload: { payroll_period_id: string; driver_id: string; date_basis?: string }): Observable<any> {
    return this.http.post(`${this.baseUrl}/settlements/draft`, payload);
  }

  createEquipmentOwner(payload: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    address_line_2?: string;
    city?: string;
    state?: string;
    zip?: string;
    fid_ein?: string;
    mc?: string;
    notes?: string;
    vendor_type?: string;
    is_additional_payee?: boolean;
    is_equipment_owner?: boolean;
    additional_payee_rate?: number | null;
    settlement_template_type?: string;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/settlements/payees/equipment-owner`, payload);
  }

  resolveDriverPayeeAssignment(driverId: string, payload: {
    primary_payee_id?: string;
    primary_payee_name?: string;
    primary_payee_type?: string;
    additional_payee_id?: string;
    additional_payee_name?: string;
    additional_payee_type?: string;
    rule_type?: string;
    effective_start_date?: string;
    effective_end_date?: string;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/settlements/drivers/${driverId}/payee-assignment/resolve`, payload);
  }

  saveExpenseResponsibility(driverId: string, payload: {
    fuel_responsibility?: string | null;
    insurance_responsibility?: string | null;
    eld_responsibility?: string | null;
    trailer_rent_responsibility?: string | null;
    toll_responsibility?: string | null;
    repairs_responsibility?: string | null;
    effective_start_date?: string;
    effective_end_date?: string | null;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/settlements/drivers/${driverId}/expense-responsibility`, payload);
  }

  getPayeeAssignment(driverId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/settlements/drivers/${driverId}/payee-assignment`);
  }

  getAllPayees(params?: { search?: string; type?: string; is_active?: boolean; limit?: number }): Observable<any> {
    let url = `${this.baseUrl}/settlements/payees`;
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.type) q.set('type', params.type);
    if (params?.is_active !== undefined) q.set('is_active', String(params.is_active));
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    if (qs) url += `?${qs}`;
    return this.http.get(url);
  }

  searchPayees(term: string, role: 'primary' | 'additional' | 'all' = 'all', limit: number = 50): Observable<any> {
    return this.http.get(`${this.baseUrl}/settlements/payees/search`, {
      params: { q: term, role, limit: String(limit) }
    });
  }

  createPayee(payload: {
    type: string;
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    address_line_2?: string;
    city?: string;
    state?: string;
    zip?: string;
    fid_ein?: string;
    mc?: string;
    vendor_type?: string;
    notes?: string;
    is_additional_payee?: boolean;
    is_equipment_owner?: boolean;
    additional_payee_rate?: number | null;
    settlement_template_type?: string;
    is_active?: boolean;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/settlements/payees`, payload);
  }

  updatePayee(id: string, payload: {
    type?: string;
    name?: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    address_line_2?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    fid_ein?: string | null;
    mc?: string | null;
    vendor_type?: string | null;
    notes?: string | null;
    is_active?: boolean;
    is_additional_payee?: boolean;
    is_equipment_owner?: boolean;
    additional_payee_rate?: number | null;
    settlement_template_type?: string | null;
  }): Observable<any> {
    return this.http.put(`${this.baseUrl}/settlements/payees/${id}`, payload);
  }

  getRecurringDeductions(params?: { driver_id?: string; payee_id?: string; payee_ids?: string[]; enabled?: boolean | string }): Observable<any> {
    let url = `${this.baseUrl}/settlements/recurring-deductions`;
    const q = new URLSearchParams();
    if (params?.driver_id) q.set('driver_id', params.driver_id);
    if (params?.payee_id) q.set('payee_id', params.payee_id);
    if (params?.payee_ids?.length) q.set('payee_ids', params.payee_ids.join(','));
    if (params?.enabled !== undefined && params?.enabled !== '') q.set('enabled', String(params.enabled));
    const qs = q.toString();
    if (qs) url += `?${qs}`;
    return this.http.get(url);
  }

  createRecurringDeduction(payload: {
    driver_id?: string;
    payee_id?: string;
    equipment_id?: string;
    rule_scope: string;
    description: string;
    amount_type: string;
    amount: number;
    frequency: string;
    start_date: string;
    end_date?: string;
    source_type?: string;
    applies_when?: string;
    enabled: boolean;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/settlements/recurring-deductions`, payload);
  }

  updateRecurringDeduction(id: string, payload: {
    driver_id?: string;
    payee_id?: string;
    equipment_id?: string;
    rule_scope?: string;
    description?: string;
    amount_type?: string;
    amount?: number;
    frequency?: string;
    start_date?: string;
    end_date?: string;
    enabled?: boolean;
    applies_when?: string;
    source_type?: string;
  }): Observable<any> {
    return this.http.patch(`${this.baseUrl}/settlements/recurring-deductions/${id}`, payload);
  }

  deleteRecurringDeduction(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/settlements/recurring-deductions/${id}`);
  }

  backfillRecurringDeductions(payload: {
    driver_id?: string;
    start_date: string;
    end_date: string;
    include_locked?: boolean;
    dry_run?: boolean;
    limit?: number;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/settlements/recurring-deductions/backfill`, payload);
  }

  getExpenseResponsibility(driverId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/settlements/drivers/${driverId}/expense-responsibility`);
  }

  getPayrollPeriods(params?: { status?: string; limit?: number }): Observable<any> {
    let url = `${this.baseUrl}/settlements/payroll-periods`;
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.limit != null) q.set('limit', String(params.limit));
    const qs = q.toString();
    if (qs) url += `?${qs}`;
    return this.http.get(url);
  }

  createPayrollPeriod(payload: { period_start: string; period_end: string; run_type?: string }): Observable<any> {
    return this.http.post(`${this.baseUrl}/settlements/payroll-periods`, payload);
  }

  // DQF Documents
  uploadDQFDocument(driverId: string, documentType: string, file: File, uploadedBy: string = 'admin'): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('driverId', driverId);
    formData.append('documentType', documentType);
    formData.append('uploadedBy', uploadedBy);
    return this.http.post(`${this.baseUrl}/dqf-documents/upload`, formData);
  }

  getDriverDocuments(driverId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/dqf-documents/driver/${driverId}`);
  }

  getDriverDocumentsByType(driverId: string, documentType: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/dqf-documents/driver/${driverId}/type/${documentType}`);
  }

  deleteDQFDocument(documentId: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/dqf-documents/${documentId}`);
  }

  downloadDQFDocument(documentId: string): string {
    return `${this.baseUrl}/dqf-documents/download/${documentId}`;
  }

  // Blob download helpers for authenticated file downloads
  downloadDQFDocumentBlob(documentId: string): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/dqf-documents/download/${documentId}`, {
      responseType: 'blob'
    });
  }

  downloadDriverGeneratedDocumentBlob(documentId: string): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/dqf/documents/${documentId}/download`, {
      responseType: 'blob'
    });
  }

  // Vehicles
  // Search vehicles by (partial) VIN
  getVehiclesByVin(vin: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/vehicles/search?vin=${encodeURIComponent(vin)}`);
  }

  decodeVin(vin: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/vehicles/decode-vin/${encodeURIComponent(vin)}`);
  }
  getVehicles(): Observable<any> {
    return this.http.get(`${this.baseUrl}/vehicles`);
  }

  getVehicle(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/vehicles/${id}`);
  }

  createVehicle(vehicle: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/vehicles`, vehicle);
  }

  // Customer Vehicles
  createCustomerVehicle(vehicle: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/vehicles/customer`, vehicle);
  }

  updateVehicle(id: string, vehicle: any): Observable<any> {
    return this.http.put(`${this.baseUrl}/vehicles/${id}`, vehicle);
  }

  // HOS
  getHosRecords(): Observable<any> {
    return this.http.get(`${this.baseUrl}/hos`);
  }

  getHosViolations(): Observable<any> {
    return this.http.get(`${this.baseUrl}/hos/violations`);
  }

  // Maintenance
  getMaintenanceRecords(): Observable<any> {
    return this.http.get(`${this.baseUrl}/maintenance`);
  }

  getPendingMaintenance(): Observable<any> {
    return this.http.get(`${this.baseUrl}/maintenance/status/pending`);
  }

  createMaintenanceRecord(record: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/maintenance`, record);
  }

  updateMaintenanceRecord(id: string, record: any): Observable<any> {
    return this.http.put(`${this.baseUrl}/maintenance/${id}`, record);
  }

  // Work Orders
  createWorkOrder(workOrder: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/work-orders`, workOrder);
  }

  getWorkOrder(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/work-orders/${id}`);
  }

  updateWorkOrder(id: string, workOrder: any): Observable<any> {
    return this.http.put(`${this.baseUrl}/work-orders/${id}`, workOrder);
  }

  reserveWorkOrderPart(id: string, payload: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/work-orders/${id}/parts`, payload);
  }

  reserveWorkOrderPartsByScan(id: string, payload: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/work-orders/${id}/parts/scan`, payload);
  }

  issueWorkOrderPart(id: string, partLineId: string, qtyToIssue: number): Observable<any> {
    return this.http.post(`${this.baseUrl}/work-orders/${id}/parts/${partLineId}/issue`, { qtyToIssue });
  }

  returnWorkOrderPart(id: string, partLineId: string, qtyToReturn: number): Observable<any> {
    return this.http.post(`${this.baseUrl}/work-orders/${id}/parts/${partLineId}/return`, { qtyToReturn });
  }

  listWorkOrders(filters?: any): Observable<any> {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.set(key, String(value));
        }
      });
    }
    const query = params.toString();
    const url = query ? `${this.baseUrl}/work-orders?${query}` : `${this.baseUrl}/work-orders`;
    return this.http.get(url);
  }

  updateWorkOrderStatus(id: string, status: string): Observable<any> {
    return this.http.patch(`${this.baseUrl}/work-orders/${id}/status`, { status });
  }

  generateInvoiceFromWorkOrder(id: string, payload?: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/work-orders/${id}/generate-invoice`, payload || {});
  }

  downloadWorkOrderUploadTemplate(): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/work-orders/bulk-upload/template`, { responseType: 'blob' });
  }

  bulkUploadWorkOrders(file: File): Observable<any> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post(`${this.baseUrl}/work-orders/bulk-upload`, form);
  }

  uploadWorkOrderDocument(id: string, file: File): Observable<any> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post(`${this.baseUrl}/work-orders/${id}/documents`, form);
  }

  getWorkOrderDocuments(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/work-orders/${id}/documents`);
  }

  // Loads
  getLoads(): Observable<any> {
    return this.http.get(`${this.baseUrl}/loads`);
  }

  getLoad(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/loads/${id}`);
  }

  createLoad(load: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/loads`, load);
  }

  updateLoad(id: string, load: any): Observable<any> {
    return this.http.put(`${this.baseUrl}/loads/${id}`, load);
  }

  // Audit
  getAuditTrail(): Observable<any> {
    return this.http.get(`${this.baseUrl}/audit/trail`);
  }

  getComplianceSummary(): Observable<any> {
    return this.http.get(`${this.baseUrl}/audit/compliance-summary`);
  }

  exportData(category: string, startDate?: string, endDate?: string): Observable<any> {
    let url = `${this.baseUrl}/audit/export/${category}`;
    if (startDate && endDate) {
      url += `?startDate=${startDate}&endDate=${endDate}`;
    }
    return this.http.get(url);
  }

  // DQF / Driver onboarding
  getDqfDriver(driverId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/dqf/drivers/${driverId}`);
  }

  recalculateDqfCompleteness(driverId: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/dqf/driver/${driverId}/recalculate`, {});
  }

  updateDqfRequirementStatus(
    driverId: string,
    requirementKey: string,
    payload: {
      status: 'missing' | 'sent' | 'received' | 'complete' | 'review_required';
      evidenceDocumentId?: string;
      completionDate?: string;
      note?: string;
    }
  ): Observable<any> {
    return this.http.post(
      `${this.baseUrl}/dqf/requirement/${driverId}/${requirementKey}`,
      payload
    );
  }

  getDqfRequirementChanges(driverId: string, requirementKey: string): Observable<any> {
    return this.http.get(
      `${this.baseUrl}/dqf/requirement/${driverId}/${requirementKey}/changes`
    );
  }

  getDriverClearanceStatus(driverId: string): Observable<{
    cleared: boolean;
    requirements?: { key: string; label: string; met: boolean; link?: string }[];
    missingItems: string[];
  }> {
    return this.http.get<{ cleared: boolean; requirements?: { key: string; label: string; met: boolean; link?: string }[]; missingItems: string[] }>(
      `${this.baseUrl}/drug-alcohol/driver/${driverId}/clearance-status`
    );
  }

  // ── Pre-Hire Documents (FN-237) ──
  getDriverPrehireDocuments(driverId: string): Observable<any[]> {
    return this.http.get<any[]>(
      `${this.baseUrl}/dqf/driver/${driverId}/prehire-documents`
    );
  }

  // ── FN-240: Auto-pull employment application document ──
  autoPullEmploymentApp(driverId: string): Observable<any> {
    return this.http.post<any>(
      `${this.baseUrl}/dqf/driver/${driverId}/auto-pull-emp-app`,
      {}
    );
  }

  // ── FN-264: MVR report upload and data retrieval ──
  uploadMvrReport(driverId: string, file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post(
      `${this.baseUrl}/dqf/driver/${driverId}/mvr-upload`,
      formData
    );
  }

  getMvrData(driverId: string): Observable<any> {
    return this.http.get(
      `${this.baseUrl}/dqf/driver/${driverId}/mvr-data`
    );
  }

  // ── Drug & Alcohol Test Management (FN-214) ──
  getDrugAlcoholTests(driverId: string): Observable<any[]> {
    return this.http.get<any[]>(
      `${this.baseUrl}/drug-alcohol/driver/${driverId}/tests`
    );
  }

  createDrugAlcoholTest(driverId: string, payload: any): Observable<any> {
    return this.http.post(
      `${this.baseUrl}/drug-alcohol/driver/${driverId}/tests`,
      payload
    );
  }

  updateDrugAlcoholTest(testId: string, payload: any): Observable<any> {
    return this.http.put(
      `${this.baseUrl}/drug-alcohol/tests/${testId}`,
      payload
    );
  }

  markTestClearinghouseReported(testId: string): Observable<any> {
    return this.http.patch(
      `${this.baseUrl}/drug-alcohol/tests/${testId}/clearinghouse-reported`,
      {}
    );
  }

  uploadDrugTestResultDocument(driverId: string, testId: string, file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post(
      `${this.baseUrl}/drug-alcohol/driver/${driverId}/tests/${testId}/result-document`,
      formData
    );
  }

  createOnboardingPacket(driverId: string, driverPayload?: any): Observable<any> {
    const body: any = {};
    if (driverId) {
      body.driverId = driverId;
    }
    if (driverPayload) {
      body.driver = driverPayload;
    }
    return this.http.post(`${this.baseUrl}/onboarding/packets`, body);
  }

  sendOnboardingPacket(
    packetId: string,
    payload: { via: 'sms' | 'email' | 'both'; phone?: string; email?: string }
  ): Observable<any> {
    return this.http.post(`${this.baseUrl}/onboarding/packets/${packetId}/send`, payload);
  }

  // Public driver onboarding (packet link the driver opens)
  getPublicOnboardingPacket(packetId: string, token: string): Observable<any> {
    const publicBase = this.baseUrl.replace(/\/api\/?$/, '/public/onboarding');
    return this.http.get(`${publicBase}/${encodeURIComponent(packetId)}`, {
      params: { token }
    });
  }

  saveOnboardingSection(
    packetId: string,
    sectionKey: 'employment_application' | 'mvr_authorization' | 'uploads',
    data: any,
    status: 'not_started' | 'in_progress' | 'completed',
    token: string
  ): Observable<any> {
    const publicBase = this.baseUrl.replace(/\/api\/?$/, '/public/onboarding');
    return this.http.post(
      `${publicBase}/${encodeURIComponent(packetId)}/sections/${encodeURIComponent(sectionKey)}`,
      { data, status },
      { params: { token } }
    );
  }

  saveOnboardingEsignature(
    packetId: string,
    payload: {
      sectionKey: 'employment_application' | 'mvr_authorization';
      signerName: string;
      signatureValue: string;
      signatureType?: string;
      consentTextVersion?: string;
    },
    token: string
  ): Observable<any> {
    const publicBase = this.baseUrl.replace(/\/api\/?$/, '/public/onboarding');
    return this.http.post(
      `${publicBase}/${encodeURIComponent(packetId)}/esignatures`,
      payload,
      { params: { token } }
    );
  }

  // Public onboarding document upload (FN-250)
  uploadOnboardingDocument(
    packetId: string,
    docType: string,
    file: File,
    token: string
  ): Observable<{ document: { id: string; document_type: string; file_name: string; uploaded_at: string } }> {
    const publicBase = this.baseUrl.replace(/\/api\/?$/, '/public/onboarding');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('documentType', docType);
    return this.http.post<{ document: { id: string; document_type: string; file_name: string; uploaded_at: string } }>(
      `${publicBase}/${encodeURIComponent(packetId)}/upload-document`,
      formData,
      { params: { token } }
    );
  }

  getOnboardingDocuments(
    packetId: string,
    token: string
  ): Observable<{ documents: { id: string; document_type: string; file_name: string; uploaded_at: string }[] }> {
    const publicBase = this.baseUrl.replace(/\/api\/?$/, '/public/onboarding');
    return this.http.get<{ documents: { id: string; document_type: string; file_name: string; uploaded_at: string }[] }>(
      `${publicBase}/${encodeURIComponent(packetId)}/documents`,
      { params: { token } }
    );
  }

  deleteOnboardingDocument(
    packetId: string,
    documentId: string,
    token: string
  ): Observable<{ success: boolean }> {
    const publicBase = this.baseUrl.replace(/\/api\/?$/, '/public/onboarding');
    return this.http.delete<{ success: boolean }>(
      `${publicBase}/${encodeURIComponent(packetId)}/documents/${encodeURIComponent(documentId)}`,
      { params: { token } }
    );
  }

  // FN-270: Finalize (submit) an onboarding packet
  finalizeOnboardingPacket(
    packetId: string,
    token: string
  ): Observable<{ success: boolean; message: string; emailSent: boolean }> {
    const publicBase = this.baseUrl.replace(/\/api\/?$/, '/public/onboarding');
    return this.http.post<{ success: boolean; message: string; emailSent: boolean }>(
      `${publicBase}/${encodeURIComponent(packetId)}/finalize`,
      {},
      { params: { token } }
    );
  }

  updateCommunicationPreferences(payload: {
    email?: string;
    phone?: string;
    optInEmail: boolean;
    optInSms: boolean;
  }): Observable<any> {
    return this.http.put(`${this.baseUrl}/communication-preferences`, payload);
  }

  // Auth
  login(username: string, password: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/auth/login`, { username, password });
  }

  forgotPassword(email: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/auth/forgot-password`, { email });
  }

  resetPassword(token: string, password: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/auth/reset-password`, { token, password });
  }

  submitContactForm(payload: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/contact`, payload);
  }

    // Public marketing website
    getMarketingPlans(): Observable<any> {
      return this.http.get(`${this.baseUrl}/public/trial-requests/plans`);
    }

    submitTrialRequest(payload: {
      companyName: string;
      contactName: string;
      email: string;
      phone: string;
      fleetSize: string;
      currentSystem?: string;
      dot_number: string;
      mc_number?: string | null;
      requestedPlan: 'basic' | 'multi_mc' | 'end_to_end';
      wantsDemoAssistance: boolean;
      notes?: string;
    }): Observable<any> {
      return this.http.post(`${this.baseUrl}/public/trial-requests`, payload);
    }

    // Admin trial requests
    listTrialRequests(params?: {
      status?: 'new' | 'contacted' | 'approved' | 'rejected' | 'converted' | 'trial_created';
      page?: number;
      pageSize?: number;
    }): Observable<any> {
      const queryParts: string[] = [];
      if (params?.status) queryParts.push(`status=${encodeURIComponent(params.status)}`);
      if (params?.page) queryParts.push(`page=${params.page}`);
      if (params?.pageSize) queryParts.push(`pageSize=${params.pageSize}`);
      const query = queryParts.length ? `?${queryParts.join('&')}` : '';
      return this.http.get(`${this.baseUrl}/public/trial-requests${query}`);
    }

    getTrialRequest(id: string): Observable<any> {
      return this.http.get(`${this.baseUrl}/public/trial-requests/${encodeURIComponent(id)}`);
    }

    updateTrialRequestStatus(
      id: string,
      status: 'new' | 'contacted' | 'approved' | 'rejected' | 'converted' | 'trial_created'
    ): Observable<any> {
      return this.http.patch(`${this.baseUrl}/public/trial-requests/${encodeURIComponent(id)}/status`, { status });
    }

    getTrialRequestActivationLink(id: string, regenerate = false): Observable<any> {
      const query = regenerate ? '?regenerate=true' : '';
      return this.http.get(`${this.baseUrl}/public/trial-requests/${encodeURIComponent(id)}/activation-link${query}`);
    }

    resetTenantAdminPassword(trialRequestId: string): Observable<any> {
      return this.http.post(
        `${this.baseUrl}/public/trial-requests/${encodeURIComponent(trialRequestId)}/reset-tenant-admin-password`,
        {}
      );
    }

    /** FN-102: Update DOT / MC number on a trial request (admin-only). */
    patchTrialRequestDotMc(
      id: string,
      dotNumber: string | null,
      mcNumber?: string | null
    ): Observable<any> {
      return this.http.patch(
        `${this.baseUrl}/public/trial-requests/${encodeURIComponent(id)}`,
        { dot_number: dotNumber ?? null, mc_number: mcNumber ?? null }
      );
    }

    getTrialSignupContext(token: string): Observable<any> {
      return this.http.get(`${this.baseUrl}/public/trial-requests/signup/${encodeURIComponent(token)}`);
    }

    /** FN-10: Public username availability for trial signup (debounced on client). */
    checkTrialSignupUsername(username: string): Observable<any> {
      const q = encodeURIComponent(String(username ?? '').trim());
      return this.http.get(
        `${this.baseUrl}/public/trial-requests/signup/check-username?username=${q}`
      );
    }

    completeTrialSignup(
      token: string,
      payload: {
        password: string;
        username?: string;
        firstName?: string;
        lastName?: string;
      }
    ): Observable<any> {
      return this.http.post(
        `${this.baseUrl}/public/trial-requests/signup/${encodeURIComponent(token)}/complete`,
        payload
      );
    }

    // Billing / trial card setup
    getBillingTrialStatus(): Observable<any> {
      return this.http.get(`${this.baseUrl}/billing/trial-status`);
    }

    createBillingSetupIntent(): Observable<any> {
      return this.http.post(`${this.baseUrl}/billing/setup-intent`, {});
    }

    confirmBillingPaymentMethod(paymentMethodId: string): Observable<any> {
      return this.http.post(`${this.baseUrl}/billing/payment-method/confirm`, { paymentMethodId });
    }

    getBillingPaymentMethod(): Observable<any> {
      return this.http.get(`${this.baseUrl}/billing/payment-method`);
    }

    removeBillingPaymentMethod(): Observable<any> {
      return this.http.delete(`${this.baseUrl}/billing/payment-method`);
    }

    getBillingSeatUsage(): Observable<any> {
      return this.http.get(`${this.baseUrl}/billing/seat-usage`);
    }

    purchaseBillingExtraSeats(quantity = 1): Observable<any> {
      return this.http.post(`${this.baseUrl}/billing/extra-seats/purchase`, { quantity });
    }

  // ========== INVENTORY MANAGEMENT (PHASE 2) ==========

  // Parts Catalog
  getParts(filters?: any): Observable<any> {
    let url = `${this.baseUrl}/parts`;
    const params = new URLSearchParams();
    if (filters?.category) params.set('category', filters.category);
    if (filters?.manufacturer) params.set('manufacturer', filters.manufacturer);
    if (filters?.search) params.set('search', filters.search);
    if (params.toString()) url += `?${params.toString()}`;
    return this.http.get(url);
  }

  getPartCategories(): Observable<any> {
    return this.http.get(`${this.baseUrl}/parts/categories`);
  }

  getPartManufacturers(): Observable<any> {
    return this.http.get(`${this.baseUrl}/parts/manufacturers`);
  }

  getPartById(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/parts/${id}`);
  }

  createPart(part: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/parts`, part);
  }

  downloadPartsTemplate(): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/parts/template`, { responseType: 'blob' });
  }

  bulkUploadParts(file: File): Observable<any> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post(`${this.baseUrl}/parts/bulk-upload`, form);
  }

  updatePart(id: string, part: any): Observable<any> {
    return this.http.put(`${this.baseUrl}/parts/${id}`, part);
  }

  deactivatePart(id: string): Observable<any> {
    return this.http.patch(`${this.baseUrl}/parts/${id}/deactivate`, {});
  }

  // Inventory
  getInventory(locationId: string, filters?: any): Observable<any> {
    let url = `${this.baseUrl}/inventory?locationId=${locationId}`;
    if (filters?.category) url += `&category=${filters.category}`;
    if (filters?.search) url += `&search=${encodeURIComponent(filters.search)}`;
    return this.http.get(url);
  }

  getInventoryLocationSummary(): Observable<any> {
    return this.http.get(`${this.baseUrl}/inventory/location-summary`);
  }

  getInventoryAlerts(locationId: string, severity?: string): Observable<any> {
    let url = `${this.baseUrl}/inventory/alerts?locationId=${locationId}`;
    if (severity) url += `&severity=${severity}`;
    return this.http.get(url);
  }

  getInventoryStatus(locationId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/inventory/status/${locationId}`);
  }

  updateInventoryItem(id: string, data: any): Observable<any> {
    return this.http.put(`${this.baseUrl}/inventory/${id}`, data);
  }

  // Receiving
  getReceivingTickets(locationId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/receiving?locationId=${locationId}`);
  }

  getReceivingTicket(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/receiving/${id}`);
  }

  createReceivingTicket(locationId: string, vendorName?: string, referenceNumber?: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/receiving`, { locationId, vendorName, referenceNumber });
  }

  addReceivingLine(ticketId: string, partId: string, qtyReceived: number, unitCost?: number, binLocationOverride?: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/receiving/${ticketId}/lines`, {
      partId,
      qtyReceived,
      unitCost,
      binLocationOverride
    });
  }

  deleteReceivingLine(ticketId: string, lineId: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/receiving/${ticketId}/lines/${lineId}`);
  }

  postReceivingTicket(ticketId: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/receiving/${ticketId}/post`, {});
  }

  // Adjustments
  getAdjustments(locationId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/adjustments?locationId=${locationId}`);
  }

  getAdjustment(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/adjustments/${id}`);
  }

  createAdjustment(data: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/adjustments`, data);
  }

  updateAdjustment(id: string, data: any): Observable<any> {
    return this.http.put(`${this.baseUrl}/adjustments/${id}`, data);
  }

  postAdjustment(id: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/adjustments/${id}/post`, {});
  }

  // Cycle Counts
  getCycleCounts(locationId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/cycle-counts?locationId=${locationId}`);
  }

  getCycleCount(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/cycle-counts/${id}`);
  }

  createCycleCount(locationId: string, method: string, filterValue?: any, assignedToUserId?: string, countDate?: Date): Observable<any> {
    return this.http.post(`${this.baseUrl}/cycle-counts`, {
      locationId,
      method,
      filterValue,
      assignedToUserId,
      countDate
    });
  }

  updateCycleCountLine(cycleCountId: string, lineId: string, countedQty: number, notes?: string): Observable<any> {
    return this.http.put(`${this.baseUrl}/cycle-counts/${cycleCountId}/lines/${lineId}`, {
      countedQty,
      notes
    });
  }

  submitCycleCount(id: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/cycle-counts/${id}/submit`, {});
  }

  approveCycleCount(id: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/cycle-counts/${id}/approve`, {});
  }

  // Reports
  getInventoryStatusReport(locationId?: string, filters?: any): Observable<any> {
    let url = `${this.baseUrl}/reports/inventory-status`;
    const params = new URLSearchParams();
    if (locationId) params.set('locationId', locationId);
    if (filters?.category) params.set('category', filters.category);
    if (filters?.status) params.set('status', filters.status);
    if (params.toString()) url += `?${params.toString()}`;
    return this.http.get(url);
  }

  getLowStockReport(locationId?: string): Observable<any> {
    let url = `${this.baseUrl}/reports/low-stock`;
    if (locationId) url += `?locationId=${locationId}`;
    return this.http.get(url);
  }

  getValuationReport(locationId?: string): Observable<any> {
    let url = `${this.baseUrl}/reports/valuation`;
    if (locationId) url += `?locationId=${locationId}`;
    return this.http.get(url);
  }

  getMovementReport(locationId?: string, startDate?: string, endDate?: string, transactionType?: string): Observable<any> {
    let url = `${this.baseUrl}/reports/movement`;
    const params = new URLSearchParams();
    if (locationId) params.set('locationId', locationId);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (transactionType) params.set('transactionType', transactionType);
    if (params.toString()) url += `?${params.toString()}`;
    return this.http.get(url);
  }

  getCycleVarianceReport(locationId?: string): Observable<any> {
    let url = `${this.baseUrl}/reports/cycle-variance`;
    if (locationId) url += `?locationId=${locationId}`;
    return this.http.get(url);
  }

  // Step 2/3 - Barcode + Inventory Ops
  lookupBarcode(code: string, locationId?: string): Observable<any> {
    let url = `${this.baseUrl}/barcodes/${encodeURIComponent(code)}`;
    if (locationId) {
      url += `?locationId=${encodeURIComponent(locationId)}`;
    }
    return this.http.get(url);
  }

  /** Desktop: decode barcode from uploaded image. See docs/API-BARCODE-SCAN-PHONE-BRIDGE.md §2.1. POST /api/barcodes/decode-image (JWT). Body: multipart/form-data, field "image". */
  decodeBarcodeFromImage(file: File): Observable<any> {
    const form = new FormData();
    form.append('image', file);
    return this.http.post(`${this.baseUrl}/barcodes/decode-image`, form);
  }

  assignPartBarcode(partId: string, payload: { barcodeValue: string; packQty?: number; vendor?: string }): Observable<any> {
    return this.http.post(`${this.baseUrl}/parts/${partId}/barcodes`, payload);
  }

  getPartBarcodes(partId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/parts/${partId}/barcodes`);
  }

  receiveInventory(payload: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/inventory/receive`, payload);
  }

  createTransfer(payload: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/inventory/transfer`, payload);
  }

  receiveTransfer(transferId: string, payload?: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/inventory/transfer/${transferId}/receive`, payload || {});
  }

  consumeInventory(payload: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/inventory/consume`, payload);
  }

  createDirectSale(payload: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/inventory/sale`, payload);
  }

  getInventoryTransactions(filters?: any): Observable<any> {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.set(key, String(value));
        }
      });
    }
    const query = params.toString();
    const url = query ? `${this.baseUrl}/inventory/transactions?${query}` : `${this.baseUrl}/inventory/transactions`;
    return this.http.get(url);
  }

  createScanBridgeSession(): Observable<any> {
    return this.http.post(`${this.baseUrl}/scan-bridge/session`, {});
  }

  sendScanBridgeBarcode(sessionId: string, writeToken: string, barcode: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/scan-bridge/session/${sessionId}/scan`, {
      writeToken,
      barcode
    });
  }

  // Safety: Claims & Accidents
  getSafetyOverview(): Observable<any> {
    return this.http.get(`${this.baseUrl}/safety/overview`);
  }

  getSafetyIncidents(filters?: Record<string, any>): Observable<any> {
    const params = new URLSearchParams();
    Object.entries(filters || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, String(value));
      }
    });
    const query = params.toString();
    const url = query ? `${this.baseUrl}/safety/incidents?${query}` : `${this.baseUrl}/safety/incidents`;
    return this.http.get(url);
  }

  createSafetyIncident(payload: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/safety/incidents`, payload);
  }

  getSafetyIncidentById(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/safety/incidents/${id}`);
  }

  updateSafetyIncident(id: string, payload: any): Observable<any> {
    return this.http.patch(`${this.baseUrl}/safety/incidents/${id}`, payload);
  }

  closeSafetyIncident(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/safety/incidents/${id}`);
  }

  getSafetyClaims(filters?: Record<string, any>): Observable<any> {
    const params = new URLSearchParams();
    Object.entries(filters || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, String(value));
      }
    });
    const query = params.toString();
    const url = query ? `${this.baseUrl}/safety/claims?${query}` : `${this.baseUrl}/safety/claims`;
    return this.http.get(url);
  }

  getSafetyClaimById(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/safety/claims/${id}`);
  }

  updateSafetyClaim(id: string, payload: any): Observable<any> {
    return this.http.patch(`${this.baseUrl}/safety/claims/${id}`, payload);
  }

  getSafetyTasks(filters?: Record<string, any>): Observable<any> {
    const params = new URLSearchParams();
    Object.entries(filters || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, String(value));
      }
    });
    const query = params.toString();
    const url = query ? `${this.baseUrl}/safety/tasks?${query}` : `${this.baseUrl}/safety/tasks`;
    return this.http.get(url);
  }

  getSafetyReports(filters?: Record<string, any>): Observable<any> {
    const params = new URLSearchParams();
    Object.entries(filters || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, String(value));
      }
    });
    const query = params.toString();
    const url = query ? `${this.baseUrl}/safety/reports?${query}` : `${this.baseUrl}/safety/reports`;
    return this.http.get(url);
  }

  // AI-powered helpers
  triageWorkOrder(payload: {
    description: string;
    vehicleId?: string | null;
    customerId?: string | null;
    locationId?: string | null;
  }): Observable<any> {
    const aiBase = this.baseUrl.replace(/\/api\/?$/, '/api/ai');
    return this.http.post(`${aiBase}/work-order/triage`, payload);
  }

  getInventoryRecommendations(payload: {
    locationName?: string;
    onHand: Array<{ sku?: string; name?: string; on_hand_qty?: number; reserved_qty?: number; available_qty?: number; status?: string; min_stock_level?: number; reorder_qty?: number }>;
    recentTransactions?: Array<Record<string, unknown>>;
  }): Observable<any> {
    const aiBase = this.baseUrl.replace(/\/api\/?$/, '/api/ai');
    return this.http.post(`${aiBase}/inventory/recommendations`, payload);
  }

  getPartsAnalysis(payload: {
    parts: Array<{ sku?: string; name?: string; category?: string; manufacturer?: string; unit_cost?: number; unit_price?: number; quantity_on_hand?: number; reorder_level?: number; status?: string }>;
    categories?: string[];
    manufacturers?: string[];
  }): Observable<any> {
    const aiBase = this.baseUrl.replace(/\/api\/?$/, '/api/ai');
    return this.http.post(`${aiBase}/parts/analysis`, payload);
  }

  getCustomersAnalysis(payload: {
    customers: Array<{ id?: string; company_name?: string; customer_type?: string; status?: string; phone?: string; email?: string; default_location_id?: string; last_service_date?: string; payment_terms?: string; credit_limit?: number }>;
  }): Observable<any> {
    const aiBase = this.baseUrl.replace(/\/api\/?$/, '/api/ai');
    return this.http.post(`${aiBase}/customers/analysis`, payload);
  }
}

