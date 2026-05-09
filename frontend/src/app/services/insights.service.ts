import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { localDateIso } from '../shared/utils/local-date';

export type TrendSeriesId = 'loadVolume' | 'maintenance' | 'onTimePct' | 'fuelCost';

export interface TrendPoint {
  date: string;
  value: number | null;
}

export interface TrendSeries {
  actual: TrendPoint[];
  predicted: TrendPoint[];
}

export type TrendsPayload = Record<TrendSeriesId, TrendSeries>;

export interface TrendsUpstreamError {
  source: string;
  error: string;
}

export interface TrendsResponse {
  tenantId: string;
  range: '7d';
  generatedAt: string;
  window: { actualDays: string[]; futureDays: string[] };
  series: TrendsPayload;
  upstreamErrors: TrendsUpstreamError[];
  cached: boolean;
  hasBaseline?: boolean;
  firstBaselineEta?: string | null;
}

@Injectable({ providedIn: 'root' })
export class InsightsService {
  private readonly endpoint = `${environment.apiUrl}/insights/trends`;

  constructor(private http: HttpClient) {}

  getTrends(options: { range?: '7d'; refresh?: boolean } = {}): Observable<TrendsResponse> {
    let params = new HttpParams()
      .set('range', options.range ?? '7d')
      .set('localDate', localDateIso());
    if (options.refresh) {
      params = params.set('refresh', 'true');
    }
    return this.http.get<TrendsResponse>(this.endpoint, { params });
  }
}
