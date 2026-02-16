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
    if (query) url += `?q=${encodeURIComponent(query)}`;
    return this.http.get(url);
  }

  getCustomerByDot(dot: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/customers?dot=${encodeURIComponent(dot)}`);
  }

  createCustomer(customer: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/customers`, customer);
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
}
