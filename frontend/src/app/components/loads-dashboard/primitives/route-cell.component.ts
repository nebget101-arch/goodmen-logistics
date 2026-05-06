import {
  ChangeDetectionStrategy,
  Component,
  Input,
} from '@angular/core';

export interface RouteEndpoint {
  city?: string | null;
  state?: string | null;
}

/**
 * FN-1353 — Route cell.
 *
 * Renders a Pickup → Delivery summary in a single cell:
 *
 *   KCMO, MO  →  DEN, CO
 *
 * Stacks responsively on narrow widths.
 */
@Component({
  selector: 'app-route-cell',
  templateUrl: './route-cell.component.html',
  styleUrls: ['./route-cell.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RouteCellComponent {
  @Input() pickup: RouteEndpoint | null | undefined = null;
  @Input() delivery: RouteEndpoint | null | undefined = null;

  format(ep: RouteEndpoint | null | undefined): string {
    const city = (ep?.city || '').trim();
    const state = (ep?.state || '').trim();
    if (!city && !state) return '—';
    if (city && state) return `${city}, ${state}`;
    return city || state;
  }
}
