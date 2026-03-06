import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface AiSuggestion {
  id: string;
  type: 'workOrderDraft' | 'navigation' | 'explanation' | string;
  title: string;
  description: string;
  payload: any;
}

export interface AiChatResponse {
  conversationId: string;
  messages: AiChatMessage[];
  suggestions: AiSuggestion[];
  meta?: any;
}

@Injectable({
  providedIn: 'root'
})
export class AiChatService {
  private readonly baseUrl = `${environment.apiUrl}/ai/chat`;

  constructor(private http: HttpClient) {}

  sendMessage(payload: {
    message: string;
    conversationId?: string | null;
    context?: any;
    clientMeta?: any;
  }): Observable<AiChatResponse> {
    return this.http.post<AiChatResponse>(this.baseUrl, payload);
  }
}

