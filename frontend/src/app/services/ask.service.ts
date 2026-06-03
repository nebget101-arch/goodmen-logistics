import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type AskIntent = 'loads' | 'drivers' | 'vehicles' | 'generic' | string;

export interface AskAnswerText {
  kind: 'text';
  headline: string;
  detail: string;
}

export interface AskAnswerTable {
  kind: 'table';
  headline: string;
  detail?: string;
  columns: string[];
  rows: Array<Array<string | number | null>>;
}

export interface AskChartSeries {
  label: string;
  value: number;
}

export interface AskAnswerChart {
  kind: 'chart';
  headline: string;
  detail?: string;
  chartType: 'bar' | 'line' | 'pie';
  series: AskChartSeries[];
}

export interface AskAnswerMetric {
  kind: 'metric';
  headline: string;
  detail?: string;
  value: string;
}

export type AskAnswer =
  | AskAnswerText
  | AskAnswerTable
  | AskAnswerChart
  | AskAnswerMetric;

export interface AskBriefingContext {
  date?: string;
  briefing?: unknown;
  cached?: boolean;
  [key: string]: unknown;
}

export interface AskRequest {
  prompt: string;
  briefingContext?: AskBriefingContext | null;
}

export interface AskClassification {
  confidence?: number;
  reasoning?: string;
  source?: string;
}

export interface AskMeta {
  model?: string;
  processingTimeMs?: number;
}

export interface AskSuccessResponse {
  success: true;
  intent: AskIntent;
  answer: AskAnswer;
  classification?: AskClassification;
  meta?: AskMeta;
}

@Injectable({ providedIn: 'root' })
export class AskService {
  private readonly endpoint = `${environment.apiUrl}/ai/ask`;

  constructor(private http: HttpClient) {}

  ask(payload: AskRequest): Observable<AskSuccessResponse> {
    return this.http.post<AskSuccessResponse>(this.endpoint, payload);
  }
}
