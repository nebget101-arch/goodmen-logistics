import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-status-pill',
  templateUrl: './status-pill.component.html',
  styleUrls: ['./status-pill.component.scss']
})
export class StatusPillComponent {
  @Input() status: string | null = '';

  get label(): string {
    const value = (this.status || '').toString().replace(/_/g, ' ').toLowerCase();
    if (!value) return '--';
    return value.replace(/\b\w/g, (char) => char.toUpperCase());
  }

  get cssClass(): string {
    const normalized = (this.status || '').toString().toUpperCase();
    if (['DELIVERED'].includes(normalized)) return 'pill-success';
    if (['IN_TRANSIT'].includes(normalized)) return 'pill-info';
    if (['DISPATCHED', 'NEW'].includes(normalized)) return 'pill-warning';
    if (['CANCELLED'].includes(normalized)) return 'pill-danger';
    if (['PAID', 'FUNDED', 'INVOICED'].includes(normalized)) return 'pill-success';
    if (['PENDING'].includes(normalized)) return 'pill-muted';
    return 'pill-muted';
  }
}
