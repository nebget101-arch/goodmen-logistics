import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, forkJoin, of } from 'rxjs';
import { map, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface StatusCode {
  code: string;
  display_label: string;
  color_hex: string;
  sort_order: number;
  is_terminal: boolean;
}

interface StatusCodeResponse {
  success: boolean;
  data: StatusCode[];
}

@Injectable({
  providedIn: 'root'
})
export class ReferenceDataService {
  private readonly baseUrl = `${environment.apiUrl}/reference`;

  private loadStatusCodesCache: StatusCode[] | null = null;
  private billingStatusCodesCache: StatusCode[] | null = null;

  private loadStatusCodesRequest$: Observable<StatusCode[]> | null = null;
  private billingStatusCodesRequest$: Observable<StatusCode[]> | null = null;

  constructor(private http: HttpClient) {}

  preload(): Observable<void> {
    return forkJoin([
      this.getLoadStatusCodes(),
      this.getBillingStatusCodes()
    ]).pipe(map(() => void 0));
  }

  getLoadStatusCodes(forceRefresh = false): Observable<StatusCode[]> {
    if (!forceRefresh && this.loadStatusCodesCache) {
      return of(this.loadStatusCodesCache);
    }

    if (!forceRefresh && this.loadStatusCodesRequest$) {
      return this.loadStatusCodesRequest$;
    }

    const request$ = this.http
      .get<StatusCodeResponse>(`${this.baseUrl}/load-status-codes`)
      .pipe(
        map((response) => Array.isArray(response?.data) ? response.data : []),
        tap((rows) => {
          this.loadStatusCodesCache = rows;
          this.loadStatusCodesRequest$ = null;
        }),
        shareReplay(1)
      );

    this.loadStatusCodesRequest$ = request$;
    return request$;
  }

  getBillingStatusCodes(forceRefresh = false): Observable<StatusCode[]> {
    if (!forceRefresh && this.billingStatusCodesCache) {
      return of(this.billingStatusCodesCache);
    }

    if (!forceRefresh && this.billingStatusCodesRequest$) {
      return this.billingStatusCodesRequest$;
    }

    const request$ = this.http
      .get<StatusCodeResponse>(`${this.baseUrl}/billing-status-codes`)
      .pipe(
        map((response) => Array.isArray(response?.data) ? response.data : []),
        tap((rows) => {
          this.billingStatusCodesCache = rows;
          this.billingStatusCodesRequest$ = null;
        }),
        shareReplay(1)
      );

    this.billingStatusCodesRequest$ = request$;
    return request$;
  }
}
