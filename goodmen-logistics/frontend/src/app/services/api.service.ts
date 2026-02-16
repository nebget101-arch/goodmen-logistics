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

  // Locations
  getLocations(): Observable<any> {
    return this.http.get(`${this.baseUrl}/locations`);
  }

  // FMCSA company info lookup
  getFmcsainfo(dot: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/customers/fmcsainfo/${encodeURIComponent(dot)}`);
  }

  // Customers
  getCustomers(query?: string): Observable<any> {
    let url = `${this.baseUrl}/customers`;
    if (query) url += `?search=${encodeURIComponent(query)}`;
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
    createUser(user: { username: string; password: string; role: string }): Observable<any> {
      return this.http.post(`${this.baseUrl}/users`, user);
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

  generateInvoiceFromWorkOrder(id: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/work-orders/${id}/generate-invoice`, {});
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
}

