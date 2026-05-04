import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface BriefingSection {
  headline: string;
  detail: string;
  metric: string;
}

export interface BriefingPayload {
  throughput: BriefingSection;
  exceptions: BriefingSection;
  driverRisk: BriefingSection;
  vehicleRisk: BriefingSection;
  recommendedAction: BriefingSection;
}

export interface BriefingUpstreamError {
  source: string;
  error: string;
}

export interface DailyBriefingResponse {
  tenantId: string;
  date: string;
  briefing: BriefingPayload;
  upstreamErrors?: BriefingUpstreamError[];
  cached: boolean;
}

@Injectable({ providedIn: 'root' })
export class BriefingService {
  private readonly endpoint = `${environment.apiUrl}/ai/briefing`;

  constructor(private http: HttpClient) {}

  getBriefing(options: { refresh?: boolean } = {}): Observable<DailyBriefingResponse> {
    let params = new HttpParams();
    if (options.refresh) {
      params = params.set('refresh', 'true');
    }
    return this.http.get<DailyBriefingResponse>(this.endpoint, { params });
  }
}
