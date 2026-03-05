import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { InvoiceLineItem, InvoicePayment } from '../models/invoice.model';

@Injectable({
  providedIn: 'root'
})
export class InvoiceService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  listInvoices(params?: any): Observable<any> {
    let httpParams = new HttpParams();
    if (params) {
      Object.keys(params).forEach(key => {
        if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
          httpParams = httpParams.set(key, params[key]);
        }
      });
    }
    return this.http.get(`${this.baseUrl}/invoices`, { params: httpParams });
  }

  getInvoice(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/invoices/${id}`);
  }

  createFromWorkOrder(workOrderId: string, payload?: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/invoices/from-work-order/${workOrderId}`, payload || {});
  }

  createInvoice(payload: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/invoices`, payload);
  }

  updateInvoice(id: string, payload: any): Observable<any> {
    return this.http.put(`${this.baseUrl}/invoices/${id}`, payload);
  }

  updateStatus(id: string, status: string, reason?: string): Observable<any> {
    return this.http.patch(`${this.baseUrl}/invoices/${id}/status`, { status, reason });
  }

  addLineItem(id: string, item: InvoiceLineItem): Observable<any> {
    return this.http.post(`${this.baseUrl}/invoices/${id}/line-items`, item);
  }

  updateLineItem(id: string, lineItemId: string, item: InvoiceLineItem): Observable<any> {
    return this.http.put(`${this.baseUrl}/invoices/${id}/line-items/${lineItemId}`, item);
  }

  deleteLineItem(id: string, lineItemId: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/invoices/${id}/line-items/${lineItemId}`);
  }

  addPayment(id: string, payment: InvoicePayment): Observable<any> {
    return this.http.post(`${this.baseUrl}/invoices/${id}/payments`, payment);
  }

  getPayments(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/invoices/${id}/payments`);
  }

  deletePayment(id: string, paymentId: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/invoices/${id}/payments/${paymentId}`);
  }

  generatePdf(id: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/invoices/${id}/pdf`, {});
  }

  getPdf(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/invoices/${id}/pdf`);
  }

  uploadDocument(id: string, file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post(`${this.baseUrl}/invoices/${id}/documents`, formData);
  }

  getDocuments(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/invoices/${id}/documents`);
  }
}
