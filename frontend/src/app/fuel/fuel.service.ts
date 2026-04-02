import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  FuelCardAccount, FuelCard, FuelMappingProfile, FuelImportBatch, FuelImportBatchRow,
  FuelTransaction, FuelException, FuelOverview, ProviderTemplate,
  ImportPreviewResult, StageResult, AiPreprocessResult, CardDriverAssignment
} from './fuel.model';

@Injectable({ providedIn: 'root' })
export class FuelService {
  private base = `${environment.apiUrl}/fuel`;

  constructor(private http: HttpClient) {}

  // ─── Provider Templates ──────────────────────────────────────────────────────
  getProviderTemplates(): Observable<ProviderTemplate[]> {
    return this.http.get<ProviderTemplate[]>(`${this.base}/providers/templates`);
  }

  // ─── Fuel Cards ───────────────────────────────────────────────────────────────
  getCards(): Observable<FuelCardAccount[]> {
    return this.http.get<FuelCardAccount[]>(`${this.base}/cards`);
  }

  createCard(card: Partial<FuelCardAccount>): Observable<FuelCardAccount> {
    return this.http.post<FuelCardAccount>(`${this.base}/cards`, card);
  }

  updateCard(id: string, patch: Partial<FuelCardAccount>): Observable<FuelCardAccount> {
    return this.http.patch<FuelCardAccount>(`${this.base}/cards/${id}`, patch);
  }

  /** `accountId` = fuel_card_accounts id; pass `fuelCardId` (fuel_cards row) to scope one physical card (FN-673). */
  getCardAssignments(accountId: string, fuelCardId?: string): Observable<CardDriverAssignment[]> {
    let url = `${this.base}/cards/${accountId}/assignments`;
    if (fuelCardId) {
      const p = new HttpParams().set('fuelCardId', fuelCardId);
      url = `${url}?${p.toString()}`;
    }
    return this.http.get<CardDriverAssignment[]>(url);
  }

  /** Backend: camelCase `driverId`; `fuelCardId` = fuel_cards.id for per-card assign/revoke scope. */
  assignDriver(
    accountId: string,
    driverId: string,
    notes?: string,
    cardNumberLast4?: string,
    fuelCardId?: string
  ): Observable<CardDriverAssignment> {
    const body: {
      driverId: string;
      notes?: string;
      cardNumberLast4?: string;
      fuelCardId?: string;
    } = { driverId };
    if (notes) body.notes = notes;
    if (cardNumberLast4) body.cardNumberLast4 = cardNumberLast4;
    if (fuelCardId) body.fuelCardId = fuelCardId;
    return this.http.post<CardDriverAssignment>(`${this.base}/cards/${accountId}/assign-driver`, body);
  }

  revokeDriver(
    accountId: string,
    notes?: string,
    fuelCardId?: string,
    cardNumberLast4?: string
  ): Observable<CardDriverAssignment> {
    const body: { notes?: string; fuelCardId?: string; cardNumberLast4?: string } = {};
    if (notes) body.notes = notes;
    if (fuelCardId) body.fuelCardId = fuelCardId;
    if (cardNumberLast4) body.cardNumberLast4 = cardNumberLast4;
    return this.http.post<CardDriverAssignment>(`${this.base}/cards/${accountId}/revoke-driver`, body);
  }

  // ─── Cards (under Account) ─────────────────────────────────────────────────
  getAccountCards(accountId: string): Observable<FuelCard[]> {
    return this.http.get<FuelCard[]>(`${this.base}/accounts/${accountId}/cards`);
  }

  createAccountCard(accountId: string, card: Partial<FuelCard>): Observable<FuelCard> {
    return this.http.post<FuelCard>(`${this.base}/accounts/${accountId}/cards`, card);
  }

  updateFuelCard(cardId: string, patch: Partial<FuelCard>): Observable<FuelCard> {
    return this.http.patch<FuelCard>(`${this.base}/accounts/cards/${cardId}`, patch);
  }

  // ─── Mapping Profiles ─────────────────────────────────────────────────────────
  getMappingProfiles(): Observable<FuelMappingProfile[]> {
    return this.http.get<FuelMappingProfile[]>(`${this.base}/mapping-profiles`);
  }

  createMappingProfile(profile: Partial<FuelMappingProfile>): Observable<FuelMappingProfile> {
    return this.http.post<FuelMappingProfile>(`${this.base}/mapping-profiles`, profile);
  }

  deleteMappingProfile(id: string): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(`${this.base}/mapping-profiles/${id}`);
  }

  // ─── Import ───────────────────────────────────────────────────────────────────
  previewImport(file: File, providerKey: string): Observable<ImportPreviewResult> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('provider_key', providerKey);
    return this.http.post<ImportPreviewResult>(`${this.base}/import/preview`, fd);
  }

  aiPreprocess(file: File, providerKey: string, providerName: string): Observable<AiPreprocessResult> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('provider_key', providerKey);
    fd.append('provider_name', providerName);
    return this.http.post<AiPreprocessResult>(`${this.base}/import/ai-preprocess`, fd);
  }

  stageImport(file: File, providerName: string, columnMap: Record<string, string | null>, cardAccountId?: string): Observable<StageResult> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('provider_name', providerName);
    fd.append('column_map', JSON.stringify(columnMap));
    if (cardAccountId) fd.append('card_account_id', cardAccountId);
    return this.http.post<StageResult>(`${this.base}/import/stage`, fd);
  }

  commitImport(batchId: string, importWarnings = false): Observable<{ imported: number; exceptions: number }> {
    return this.http.post<{ imported: number; exceptions: number }>(
      `${this.base}/import/commit/${batchId}`,
      { import_warnings: importWarnings }
    );
  }

  // ─── Import Batches ───────────────────────────────────────────────────────────
  getBatches(limit = 50, offset = 0): Observable<{ rows: FuelImportBatch[]; total: number }> {
    const p = new HttpParams().set('limit', limit).set('offset', offset);
    return this.http.get<{ rows: FuelImportBatch[]; total: number }>(`${this.base}/import/batches`, { params: p });
  }

  getBatch(id: string): Observable<{ batch: FuelImportBatch; rows: FuelImportBatchRow[] }> {
    return this.http.get<{ batch: FuelImportBatch; rows: FuelImportBatchRow[] }>(`${this.base}/import/batches/${id}`);
  }

  // ─── Transactions ─────────────────────────────────────────────────────────────
  getTransactions(filters: {
    limit?: number; offset?: number;
    date_from?: string; date_to?: string;
    provider?: string; truck_id?: string; driver_id?: string;
    matched_status?: string; batch_id?: string;
    product_type?: string; category?: string;
  } = {}): Observable<{ rows: FuelTransaction[]; total: number }> {
    let p = new HttpParams();
    Object.entries(filters).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p = p.set(k, v.toString()); });
    return this.http.get<{ rows: FuelTransaction[]; total: number }>(`${this.base}/transactions`, { params: p });
  }

  getTransaction(id: string): Observable<{ transaction: FuelTransaction; exceptions: FuelException[] }> {
    return this.http.get<{ transaction: FuelTransaction; exceptions: FuelException[] }>(`${this.base}/transactions/${id}`);
  }

  updateTransaction(id: string, patch: Partial<FuelTransaction>): Observable<FuelTransaction> {
    return this.http.patch<FuelTransaction>(`${this.base}/transactions/${id}`, patch);
  }

  createManualTransaction(txn: Partial<FuelTransaction>): Observable<FuelTransaction> {
    return this.http.post<FuelTransaction>(`${this.base}/transactions`, txn);
  }

  deleteTransaction(id: string): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(`${this.base}/transactions/${id}`);
  }

  // ─── Exceptions ───────────────────────────────────────────────────────────────
  getExceptions(status?: string, limit = 50, offset = 0): Observable<{ rows: FuelException[]; total: number }> {
    let p = new HttpParams().set('limit', limit).set('offset', offset);
    if (status) p = p.set('status', status);
    return this.http.get<{ rows: FuelException[]; total: number }>(`${this.base}/exceptions`, { params: p });
  }

  resolveException(id: string, payload: { truck_id?: string; driver_id?: string; resolution_notes?: string; ignore?: boolean }): Observable<{ status: string }> {
    return this.http.patch<{ status: string }>(`${this.base}/exceptions/${id}/resolve`, payload);
  }

  bulkResolveExceptions(ids: string[], action: 'resolve' | 'ignore', notes?: string): Observable<{ resolved: number }> {
    return this.http.post<{ resolved: number }>(`${this.base}/exceptions/bulk-resolve`, {
      exception_ids: ids, action, resolution_notes: notes
    });
  }

  // ─── Reprocess ───────────────────────────────────────────────────────────────
  reprocessUnmatched(): Observable<{ checked: number; updated: number }> {
    return this.http.post<{ checked: number; updated: number }>(`${this.base}/reprocess-unmatched`, {});
  }

  // ─── Overview ────────────────────────────────────────────────────────────────
  getOverview(): Observable<FuelOverview> {
    return this.http.get<FuelOverview>(`${this.base}/overview`);
  }
}
