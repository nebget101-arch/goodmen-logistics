import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Customer, CustomerNote, CustomerPricingRule } from '../models/customer.model';

@Injectable({
  providedIn: 'root'
})
export class CustomerService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  listCustomers(params?: any): Observable<any> {
    let httpParams = new HttpParams();
    if (params) {
      Object.keys(params).forEach(key => {
        if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
          httpParams = httpParams.set(key, params[key]);
        }
      });
    }
    return this.http.get(`${this.baseUrl}/customers`, { params: httpParams });
  }

  getCustomer(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/customers/${id}`);
  }

  createCustomer(payload: Partial<Customer>): Observable<any> {
    return this.http.post(`${this.baseUrl}/customers`, payload);
  }

  updateCustomer(id: string, payload: Partial<Customer>): Observable<any> {
    return this.http.put(`${this.baseUrl}/customers/${id}`, payload);
  }

  setStatus(id: string, status: 'ACTIVE' | 'INACTIVE'): Observable<any> {
    return this.http.patch(`${this.baseUrl}/customers/${id}/status`, { status });
  }

  deleteCustomer(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/customers/${id}`);
  }

  getNotes(customerId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/customers/${customerId}/notes`);
  }

  addNote(customerId: string, note: Partial<CustomerNote>): Observable<any> {
    return this.http.post(`${this.baseUrl}/customers/${customerId}/notes`, note);
  }

  getPricing(customerId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/customers/${customerId}/pricing`);
  }

  updatePricing(customerId: string, payload: CustomerPricingRule): Observable<any> {
    return this.http.put(`${this.baseUrl}/customers/${customerId}/pricing`, payload);
  }

  getWorkOrders(customerId: string, params?: any): Observable<any> {
    let httpParams = new HttpParams();
    if (params) {
      Object.keys(params).forEach(key => {
        if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
          httpParams = httpParams.set(key, params[key]);
        }
      });
    }
    return this.http.get(`${this.baseUrl}/customers/${customerId}/work-orders`, { params: httpParams });
  }

  getServiceHistory(customerId: string, params?: any): Observable<any> {
    let httpParams = new HttpParams();
    if (params) {
      Object.keys(params).forEach(key => {
        if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
          httpParams = httpParams.set(key, params[key]);
        }
      });
    }
    return this.http.get(`${this.baseUrl}/customers/${customerId}/service-history`, { params: httpParams });
  }

  getVehicles(customerId: string, params?: any): Observable<any> {
    let httpParams = new HttpParams();
    if (params) {
      Object.keys(params).forEach(key => {
        if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
          httpParams = httpParams.set(key, params[key]);
        }
      });
    }
    return this.http.get(`${this.baseUrl}/customers/${customerId}/vehicles`, { params: httpParams });
  }

  // Bulk Upload Methods
  downloadUploadTemplate(): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/customers/bulk-upload/template`, { responseType: 'blob' });
  }

  bulkUploadCustomers(file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post(`${this.baseUrl}/customers/bulk-upload`, formData);
  }
}
