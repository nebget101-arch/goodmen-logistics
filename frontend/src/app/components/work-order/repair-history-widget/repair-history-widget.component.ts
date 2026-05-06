import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import {
  ComebackRisk,
  RepairHistoryPattern,
  RepairHistorySummary,
  VehicleService
} from '../../../services/vehicle.service';

type ViewState = 'idle' | 'loading' | 'ready' | 'error';

@Component({
  selector: 'app-wo-repair-history-widget',
  templateUrl: './repair-history-widget.component.html',
  styleUrls: ['./repair-history-widget.component.scss']
})
export class WoRepairHistoryWidgetComponent implements OnChanges {
  @Input() vehicleId: string | null | undefined = null;
  @Input() windowDays = 365;

  state: ViewState = 'idle';
  data: RepairHistorySummary | null = null;
  errorMessage = '';
  expanded = false;

  constructor(private vehicleService: VehicleService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['vehicleId'] || changes['windowDays']) {
      this.expanded = false;
      this.load();
    }
  }

  toggleExpanded(): void {
    if (!this.canExpand) {
      return;
    }
    this.expanded = !this.expanded;
  }

  trackByPattern = (_: number, pattern: RepairHistoryPattern): string => pattern.label;
  trackByRef = (_: number, ref: { workOrderId: string }): string => ref.workOrderId;

  get insufficientHistory(): boolean {
    return !!this.data?.insufficientHistory;
  }

  get hasData(): boolean {
    return this.state === 'ready' && !!this.data;
  }

  get canExpand(): boolean {
    return this.hasData && (this.data?.patterns?.length ?? 0) > 0;
  }

  get badgeRisk(): ComebackRisk | null {
    if (!this.data || this.data.insufficientHistory) {
      return null;
    }
    return this.data.comebackRisk ?? null;
  }

  get badgeLabel(): string {
    switch (this.badgeRisk) {
      case 'high': return 'High comeback risk';
      case 'medium': return 'Medium comeback risk';
      case 'low': return 'Low comeback risk';
      default: return '';
    }
  }

  get badgeClass(): string {
    switch (this.badgeRisk) {
      case 'high': return 'risk-high';
      case 'medium': return 'risk-medium';
      case 'low': return 'risk-low';
      default: return '';
    }
  }

  private load(): void {
    if (!this.vehicleId) {
      this.state = 'idle';
      this.data = null;
      return;
    }
    this.state = 'loading';
    this.errorMessage = '';
    this.vehicleService.getRepairHistorySummary(this.vehicleId, this.windowDays).subscribe({
      next: (res) => {
        this.data = res || null;
        this.state = 'ready';
      },
      error: (err) => {
        this.data = null;
        this.errorMessage = err?.error?.error || err?.message || 'Failed to load repair history.';
        this.state = 'error';
      }
    });
  }
}
