import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { IftaFuelEntry, IftaFinding, IftaJurisdictionSummary, IftaMilesEntry, IftaPaged, IftaQuarter } from './ifta.model';

@Injectable({ providedIn: 'root' })
export class IftaService {
  private readonly base = `${environment.apiUrl}/ifta`;

  constructor(private http: HttpClient) {}

  listQuarters(taxYear?: number, quarter?: number): Observable<IftaQuarter[]> {
    let params = new HttpParams();
    if (taxYear) params = params.set('tax_year', taxYear);
    if (quarter) params = params.set('quarter', quarter);
    return this.http.get<IftaQuarter[]>(`${this.base}/quarters`, { params });
  }

  createQuarter(payload: { quarter: number; tax_year: number; filing_entity_name?: string; selected_truck_ids?: string[] }): Observable<IftaQuarter> {
    return this.http.post<IftaQuarter>(`${this.base}/quarters`, payload);
  }

  getQuarter(id: string): Observable<IftaQuarter> {
    return this.http.get<IftaQuarter>(`${this.base}/quarters/${id}`);
  }

  patchQuarter(id: string, payload: Partial<IftaQuarter>): Observable<IftaQuarter> {
    return this.http.patch<IftaQuarter>(`${this.base}/quarters/${id}`, payload);
  }

  getMiles(id: string, limit = 50, offset = 0): Observable<IftaPaged<IftaMilesEntry>> {
    const params = new HttpParams().set('limit', limit).set('offset', offset);
    return this.http.get<IftaPaged<IftaMilesEntry>>(`${this.base}/quarters/${id}/miles`, { params });
  }

  createMiles(id: string, payload: Partial<IftaMilesEntry>): Observable<IftaMilesEntry> {
    return this.http.post<IftaMilesEntry>(`${this.base}/quarters/${id}/miles`, payload);
  }

  importMiles(id: string, payload: { rows?: Array<Partial<IftaMilesEntry>>; csv_text?: string; file_name?: string }): Observable<{ inserted: number }> {
    return this.http.post<{ inserted: number }>(`${this.base}/quarters/${id}/miles/import`, payload);
  }

  updateMiles(id: string, entryId: string, payload: Partial<IftaMilesEntry>): Observable<IftaMilesEntry> {
    return this.http.patch<IftaMilesEntry>(`${this.base}/quarters/${id}/miles/${entryId}`, payload);
  }

  deleteMiles(id: string, entryId: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.base}/quarters/${id}/miles/${entryId}`);
  }

  getFuel(id: string, limit = 50, offset = 0): Observable<IftaPaged<IftaFuelEntry>> {
    const params = new HttpParams().set('limit', limit).set('offset', offset);
    return this.http.get<IftaPaged<IftaFuelEntry>>(`${this.base}/quarters/${id}/fuel`, { params });
  }

  createFuel(id: string, payload: Partial<IftaFuelEntry>): Observable<IftaFuelEntry> {
    return this.http.post<IftaFuelEntry>(`${this.base}/quarters/${id}/fuel`, payload);
  }

  importFuel(id: string, payload: { rows?: Array<Partial<IftaFuelEntry>>; csv_text?: string; file_name?: string }): Observable<{ inserted: number }> {
    return this.http.post<{ inserted: number }>(`${this.base}/quarters/${id}/fuel/import`, payload);
  }

  updateFuel(id: string, entryId: string, payload: Partial<IftaFuelEntry>): Observable<IftaFuelEntry> {
    return this.http.patch<IftaFuelEntry>(`${this.base}/quarters/${id}/fuel/${entryId}`, payload);
  }

  deleteFuel(id: string, entryId: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.base}/quarters/${id}/fuel/${entryId}`);
  }

  recalculate(id: string): Observable<unknown> {
    return this.http.post(`${this.base}/quarters/${id}/recalculate`, {});
  }

  runAiReview(id: string): Observable<{ readiness_score: number; findings: Array<Partial<IftaFinding>>; narrative: string }> {
    return this.http.post<{ readiness_score: number; findings: Array<Partial<IftaFinding>>; narrative: string }>(`${this.base}/quarters/${id}/run-ai-review`, {});
  }

  listFindings(id: string): Observable<IftaFinding[]> {
    return this.http.get<IftaFinding[]>(`${this.base}/quarters/${id}/findings`);
  }

  resolveFinding(findingId: string, notes: string): Observable<IftaFinding> {
    return this.http.post<IftaFinding>(`${this.base}/findings/${findingId}/resolve`, { notes });
  }

  reportPreview(id: string): Observable<{ quarter: IftaQuarter; cards: Record<string, number>; summary: IftaJurisdictionSummary[]; ai_narrative?: string }> {
    return this.http.get<{ quarter: IftaQuarter; cards: Record<string, number>; summary: IftaJurisdictionSummary[]; ai_narrative?: string }>(`${this.base}/quarters/${id}/report-preview`);
  }

  finalize(id: string): Observable<unknown> {
    return this.http.post(`${this.base}/quarters/${id}/finalize`, {});
  }

  exportCsv(id: string, kind: 'miles' | 'fuel' | 'jurisdiction-summary'): Observable<Blob> {
    return this.http.get(`${this.base}/quarters/${id}/export/csv/${kind}`, { responseType: 'blob' });
  }

  exportPdf(id: string): Observable<Blob> {
    return this.http.get(`${this.base}/quarters/${id}/export/pdf`, { responseType: 'blob' });
  }

  filingPayload(id: string): Observable<unknown> {
    return this.http.get(`${this.base}/quarters/${id}/filing-payload`);
  }
}
