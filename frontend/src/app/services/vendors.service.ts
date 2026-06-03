import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { MasterEntity } from './manufacturers.service';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class VendorsService {
  private readonly baseUrl = `${environment.apiUrl}/vendors`;

  constructor(private http: HttpClient) {}

  search(q: string, limit = 10): Observable<MasterEntity[]> {
    const params = new HttpParams()
      .set('q', (q ?? '').trim())
      .set('limit', String(limit));
    return this.http
      .get<ApiEnvelope<MasterEntity[]>>(`${this.baseUrl}/search`, { params })
      .pipe(map((r) => (r && r.data) || []));
  }

  create(name: string): Observable<MasterEntity> {
    return this.http
      .post<ApiEnvelope<MasterEntity>>(this.baseUrl, { name: (name ?? '').trim() })
      .pipe(map((r) => r.data));
  }
}
