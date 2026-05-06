import { Component, Input, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { ApiService } from '../../../../services/api.service';

export type TriageInventoryStatus = 'in_stock' | 'low_stock' | 'out_of_stock' | 'not_found';

export interface TriagePart {
  partName: string;
  suggestedSku: string | null;
  qty: number;
  confidence?: number | null;
  partId: string | null;
  onHand: number | null;
  binLocation: string | null;
  reorderPoint: number | null;
  isLowStock: boolean;
  inventoryStatus: TriageInventoryStatus;
  reorderState?: 'idle' | 'pending' | 'success' | 'error';
  reorderError?: string;
  // legacy fallback when /triage-enriched isn't deployed yet
  query?: string;
}

@Component({
  selector: 'app-wo-service-details-tab',
  templateUrl: './service-details-tab.component.html',
  styleUrls: ['./service-details-tab.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WoServiceDetailsTabComponent {
  @Input() workOrder: any = {};
  @Input() partsCatalog: any[] = [];

  aiTriageLoading = false;
  aiTriageError = '';
  aiTriageResult: any = null;

  toast = '';
  toastType: 'success' | 'error' = 'success';
  private toastTimer: any = null;

  constructor(private apiService: ApiService, private cdr: ChangeDetectorRef) {}

  runAiTriage(): void {
    const parts: string[] = [];
    if (this.workOrder.problemReported) parts.push(`Problem reported: ${this.workOrder.problemReported}`);
    if (this.workOrder.serviceDescription) parts.push(`Service description: ${this.workOrder.serviceDescription}`);
    if (this.workOrder.workPerformed) parts.push(`Work performed so far: ${this.workOrder.workPerformed}`);
    const description = parts.join(' | ').trim();
    if (!description) {
      this.aiTriageError = 'Enter a problem description before asking AI for suggestions.';
      return;
    }

    this.aiTriageError = '';
    this.aiTriageLoading = true;
    this.aiTriageResult = null;

    this.apiService.triageEnrichedWorkOrder({
      description,
      vehicleId: this.workOrder.vehicleId,
      customerId: this.workOrder.customerId,
      locationId: this.workOrder.shopLocationId
    }).subscribe({
      next: (resp) => {
        this.aiTriageResult = this.normalizeTriageResult(resp);
        this.aiTriageLoading = false;
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.aiTriageLoading = false;
        this.aiTriageError = err?.error?.error || err?.message || 'AI was unable to generate suggestions.';
        this.cdr.markForCheck();
      }
    });
  }

  private normalizeTriageResult(resp: any): any {
    const result = { ...(resp || {}) };
    const rawParts = Array.isArray(result.parts) ? result.parts : [];
    result.parts = rawParts.map((p: any): TriagePart => {
      const partName = (typeof p?.partName === 'string' && p.partName.trim())
        || (typeof p?.query === 'string' ? p.query.trim() : '')
        || '';
      const suggestedSku = typeof p?.suggestedSku === 'string' && p.suggestedSku.trim() ? p.suggestedSku.trim() : null;
      const qty = Number(p?.qty);
      const confidence = typeof p?.confidence === 'number' ? p.confidence : null;
      const onHand = typeof p?.onHand === 'number' ? p.onHand : null;
      const reorderPoint = typeof p?.reorderPoint === 'number' ? p.reorderPoint : null;
      const status = this.coerceInventoryStatus(p?.inventoryStatus);
      return {
        partName,
        suggestedSku,
        qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
        confidence,
        partId: typeof p?.partId === 'string' ? p.partId : null,
        onHand,
        binLocation: typeof p?.binLocation === 'string' ? p.binLocation : null,
        reorderPoint,
        isLowStock: !!p?.isLowStock,
        inventoryStatus: status,
        reorderState: 'idle',
        query: typeof p?.query === 'string' ? p.query : undefined
      };
    });
    return result;
  }

  private coerceInventoryStatus(raw: any): TriageInventoryStatus {
    if (raw === 'in_stock' || raw === 'low_stock' || raw === 'out_of_stock' || raw === 'not_found') return raw;
    // Stale-deploy fallback: enriched response not available — treat as
    // "in_stock" so the row still renders without nudging the user toward
    // an unactionable reorder. The badge/CTA only fire on real BE values.
    return 'in_stock';
  }

  trackPart = (i: number, p: TriagePart): string => p.suggestedSku || p.partName || String(i);

  canReorder(p: TriagePart): boolean {
    if (!p.suggestedSku || !this.workOrder.shopLocationId) return false;
    if (p.reorderState === 'pending' || p.reorderState === 'success') return false;
    return p.inventoryStatus === 'low_stock' || p.inventoryStatus === 'out_of_stock';
  }

  createReorder(p: TriagePart): void {
    const locationId = this.workOrder.shopLocationId;
    if (!locationId || !p.suggestedSku) return;

    p.reorderState = 'pending';
    p.reorderError = '';
    this.cdr.markForCheck();

    const reorderPoint = p.reorderPoint || 0;
    const onHand = p.onHand || 0;
    const desiredQty = Math.max(reorderPoint * 2 - onHand, p.qty || 1, 1);

    this.apiService.createPartsReorder({
      locationId,
      partId: p.partId,
      sku: p.suggestedSku,
      qty: desiredQty,
      sourceWorkOrderId: this.workOrder.id || null
    }).subscribe({
      next: () => {
        p.reorderState = 'success';
        this.showToast('Reorder created', 'success');
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        p.reorderState = 'error';
        p.reorderError = err?.error?.error || err?.message || 'Reorder failed.';
        this.showToast(p.reorderError || 'Reorder failed.', 'error');
        this.cdr.markForCheck();
      }
    });
  }

  private showToast(message: string, type: 'success' | 'error'): void {
    this.toast = message;
    this.toastType = type;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast = '';
      this.cdr.markForCheck();
    }, 3500);
  }

  applyAiTriage(): void {
    const result = this.aiTriageResult;
    if (!result) return;

    if (result.priority && !this.workOrder.priority) {
      this.workOrder.priority = String(result.priority).toUpperCase();
    }

    if (Array.isArray(result.tasks)) {
      for (const t of result.tasks) {
        if (!t || !t.description) continue;
        const hours = Number(t.estimatedHours) || 1;
        const labor: any = { description: t.description, hours, rate: 0, cost: 0 };
        this.workOrder.labor.push(labor);
      }
    }

    if (Array.isArray(result.parts)) {
      for (const p of result.parts as TriagePart[]) {
        const lookupTerm = (p.partName || p.query || '').toLowerCase().trim();
        if (!lookupTerm && !p.suggestedSku) continue;
        const qty = Number(p.qty) || 1;

        if (p.partId) {
          const match = this.partsCatalog.find((part: any) => part.id === p.partId);
          if (match) {
            const unitCost = Number(match.unit_cost ?? match.unit_price ?? 0);
            this.workOrder.parts.push({
              partId: match.id, partName: match.name, partNumber: match.sku,
              quantity: qty, unitCost, totalCost: qty * unitCost
            });
            continue;
          }
        }

        const queryWords = lookupTerm.split(/\s+/).filter((w: string) => w.length > 1);
        const match = this.partsCatalog.find((part: any) => {
          const sku = (part.sku || '').toLowerCase();
          const name = (part.name || '').toLowerCase();
          if (p.suggestedSku && sku === p.suggestedSku.toLowerCase()) return true;
          if (sku === lookupTerm || name === lookupTerm) return true;
          if (sku.includes(lookupTerm) || name.includes(lookupTerm)) return true;
          if (queryWords.length > 0 && queryWords.every((w: string) => name.includes(w) || sku.includes(w))) return true;
          return false;
        });
        if (match) {
          const unitCost = Number(match.unit_cost ?? match.unit_price ?? 0);
          this.workOrder.parts.push({
            partId: match.id, partName: match.name, partNumber: match.sku,
            quantity: qty, unitCost, totalCost: qty * unitCost
          });
        } else {
          this.workOrder.parts.push({
            partName: p.partName || p.query || '', partNumber: p.suggestedSku || '',
            quantity: qty, unitCost: 0, totalCost: 0
          });
        }
      }
    }
  }

  isStatusAtLeast(target: string): boolean {
    const order = ['DRAFT', 'IN_PROGRESS', 'WAITING_PARTS', 'COMPLETED', 'CLOSED'];
    const current = (this.workOrder?.status || 'DRAFT').toUpperCase();
    return order.indexOf(current) >= order.indexOf(target);
  }
}
