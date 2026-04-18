import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { ApiService } from '../../../../services/api.service';

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

  constructor(private apiService: ApiService) {}

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

    this.apiService.triageWorkOrder({
      description,
      vehicleId: this.workOrder.vehicleId,
      customerId: this.workOrder.customerId,
      locationId: this.workOrder.shopLocationId
    }).subscribe({
      next: (resp: any) => {
        this.aiTriageResult = resp;
        this.aiTriageLoading = false;
      },
      error: (err: any) => {
        this.aiTriageLoading = false;
        this.aiTriageError = err?.error?.error || err?.message || 'AI was unable to generate suggestions.';
      }
    });
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
      for (const p of result.parts) {
        if (!p || !p.query) continue;
        const query = String(p.query).toLowerCase().trim();
        const qty = Number(p.qty) || 1;
        const queryWords = query.split(/\s+/).filter((w: string) => w.length > 1);
        const match = this.partsCatalog.find((part: any) => {
          const sku = (part.sku || '').toLowerCase();
          const name = (part.name || '').toLowerCase();
          if (sku === query || name === query) return true;
          if (sku.includes(query) || name.includes(query)) return true;
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
            partName: String(p.query).trim(), partNumber: '',
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
