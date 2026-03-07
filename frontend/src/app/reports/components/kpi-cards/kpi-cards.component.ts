import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-kpi-cards',
  templateUrl: './kpi-cards.component.html',
  styleUrls: ['./kpi-cards.component.css']
})
export class KpiCardsComponent {
  @Input() kpis: Array<{ label: string; value: string | number }> = [];
}
