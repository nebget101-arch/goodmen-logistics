import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
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

  // FMCSA company info lookup
  getFmcsainfo(dot: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/customers/fmcsainfo/${encodeURIComponent(dot)}`);
  }

  // Customers
  getCustomers(params?: { query?: string; pageSize?: number }): Observable<any> {
    let url = `${this.baseUrl}/customers`;
    const queryParams: string[] = [];
    if (params?.query) queryParams.push(`search=${encodeURIComponent(params.query)}`);
    if (params?.pageSize) queryParams.push(`pageSize=${params.pageSize}`);
    if (queryParams.length > 0) url += `?${queryParams.join('&')}`;
    return this.http.get(url);
  }

  getCustomerByDot(dot: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/customers?dot=${encodeURIComponent(dot)}`);
  }

  createCustomer(customer: any): Observable<any> {
    const payload = { ...customer };
    if (!payload.company_name && payload.name) {
      payload.company_name = payload.name;
    }
    return this.http.post(`${this.baseUrl}/customers`, payload);
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

  getDispatchDrivers(status?: string): Observable<any> {
    const params: any = { view: 'dispatch' };
    if (status) params.status = status;
    return this.http.get(`${this.baseUrl}/drivers`, { params });
  }

  getDqfDrivers(status?: string): Observable<any> {
    const params: any = { view: 'dqf' };
    if (status) params.status = status;
    return this.http.get(`${this.baseUrl}/drivers`, { params });
  }

  getDriver(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/drivers/${id}`);
  }

  createDriver(driver: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/drivers`, driver);
  }

  updateDriver(id: string, driver: any): Observable<any> {
    return this.http.put(`${this.baseUrl}/drivers/${id}`, driver);
  }

  deleteDriver(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/drivers/${id}`);
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

