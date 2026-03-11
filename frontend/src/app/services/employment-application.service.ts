import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class EmploymentApplicationService {
  constructor(private http: HttpClient) {}

  saveDraft(payload: any): Observable<any> {
    return this.http.post('/api/employment/applications', payload);
  }

  updateDraft(id: string, payload: any): Observable<any> {
    return this.http.put(`/api/employment/applications/${id}`, payload);
  }

  submit(id: string): Observable<any> {
    return this.http.post(`/api/employment/applications/${id}/submit`, {});
  }

  getByDriver(driverId: string): Observable<any> {
    return this.http.get(`/api/employment/applications/driver/${driverId}`);
  }

  getDocumentUrl(id: string): Observable<any> {
    return this.http.get(`/api/employment/applications/${id}/document`);
  }
}
