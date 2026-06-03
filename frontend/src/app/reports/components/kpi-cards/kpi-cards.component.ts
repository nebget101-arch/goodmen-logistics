import { Component, Input } from '@angular/core';
import { DrilldownTarget, CardDrilldownFn } from '../../reports.models';

export interface KpiCardItem {
  key?: string;
  label: string;
  value: string | number;
}

@Component({
  selector: 'app-kpi-cards',
  templateUrl: './kpi-cards.component.html',
  styleUrls: ['./kpi-cards.component.css']
})
export class KpiCardsComponent {
  @Input() kpis: KpiCardItem[] = [];
  // FN-1183: optional drill-down. When set, cards resolve to a router target
  // and render as anchors. Cards where the fn returns null render plain.
  @Input() cardDrilldown: CardDrilldownFn | null = null;

  targetFor(kpi: KpiCardItem): DrilldownTarget | null {
    if (!this.cardDrilldown) return null;
    return this.cardDrilldown({ key: kpi.key || kpi.label });
  }
}
