import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class CreditService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  /**
   * Get customer credit balance
   */
  getCustomerCreditBalance(customerId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/credit/${customerId}/balance`);
  }

  /**
   * Check if customer can use credit for an amount
   */
  checkCreditAvailability(customerId: string, amount: number): Observable<any> {
    return this.http.post(`${this.baseUrl}/credit/${customerId}/check`, { amount });
  }

  /**
   * Apply invoice to customer credit
   */
  applyInvoiceToCredit(customerId: string, invoiceId: string, amount: number): Observable<any> {
    return this.http.post(`${this.baseUrl}/credit/${customerId}/apply-invoice`, {
      invoiceId,
      amount
    });
  }

  /**
   * Apply payment to customer credit
   */
  applyPaymentToCredit(customerId: string, invoiceId: string, amount: number, method?: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/credit/${customerId}/apply-payment`, {
      invoiceId,
      amount,
      method
    });
  }

  /**
   * Update customer credit limit
   */
  updateCreditLimit(customerId: string, limit: number): Observable<any> {
    return this.http.put(`${this.baseUrl}/credit/${customerId}/limit`, { limit });
  }

  /**
   * Get credit transaction history
   */
  getCreditTransactionHistory(customerId: string, params?: any): Observable<any> {
    let httpParams = new HttpParams();
    if (params) {
      Object.keys(params).forEach(key => {
        if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
          httpParams = httpParams.set(key, String(params[key]));
        }
      });
    }
    return this.http.get(`${this.baseUrl}/credit/${customerId}/transactions`, { params: httpParams });
  }
}
