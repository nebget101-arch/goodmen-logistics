import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-status-pill',
  templateUrl: './status-pill.component.html',
  styleUrls: ['./status-pill.component.scss']
})
export class StatusPillComponent {
  @Input() status: string | null = '';

  get label(): string {
    const s = (this.status || '').toString().trim();
    if (!s) return '--';
    const map: Record<string, string> = {
      TONU: 'TONU', EN_ROUTE: 'En Route', PICKED_UP: 'Picked-up',
      BOL_RECEIVED: 'BOL received', SENT_TO_FACTORING: 'Sent to factoring'
    };
    const upper = s.toUpperCase().replace(/[\s-]+/g, '_');
    if (map[upper]) return map[upper];
    return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  get cssClass(): string {
    const normalized = (this.status || '').toString().toUpperCase().replace(/[\s-]+/g, '_');
    if (['DELIVERED'].includes(normalized)) return 'pill-success';
    if (['IN_TRANSIT', 'EN_ROUTE', 'PICKED_UP'].includes(normalized)) return 'pill-info';
    if (['DISPATCHED', 'NEW', 'TONU', 'DRAFT'].includes(normalized)) return 'pill-warning';
    if (['CANCELLED', 'CANCELED'].includes(normalized)) return 'pill-danger';
    if (['PAID', 'FUNDED', 'INVOICED', 'BOL_RECEIVED', 'SENT_TO_FACTORING'].includes(normalized)) return 'pill-success';
    if (['PENDING'].includes(normalized)) return 'pill-muted';
    return 'pill-muted';
  }
}
