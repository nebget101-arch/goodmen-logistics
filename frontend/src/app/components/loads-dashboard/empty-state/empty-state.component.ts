import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

export type EmptyStateMode =
  | 'filtered' // Filters / smart-filters are active and returned 0 rows
  | 'no-loads' // Tenant has never created a load
  | 'smart-filter-celebrate' // Smart-filter with 0 rows where 0 is actually "good news"
  | 'api-error' // Network / server failure with retry
  | 'permission-denied'; // Role cannot access loads (e.g. viewer role without permission)

/**
 * FN-821: Empty / error state card shown inside the loads table container
 * when `filteredLoads.length === 0` or a fetch failed.
 *
 * The mode input drives the illustration, copy, and available actions.
 * Parents handle the side-effects (clearing filters, navigating to create,
 * retrying the request) via the output events.
 */
@Component({
  selector: 'app-loads-empty-state',
  templateUrl: './empty-state.component.html',
  styleUrls: ['./empty-state.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadsEmptyStateComponent {
  @Input() mode: EmptyStateMode = 'filtered';
  /** Label shown when mode = 'smart-filter-celebrate' (e.g. "Overdue" → "No overdue loads"). */
  @Input() smartFilterLabel = '';
  /** Raw error message surfaced for api-error mode (shown below the headline). */
  @Input() errorDetail = '';

  @Output() clearFilters = new EventEmitter<void>();
  @Output() createLoad = new EventEmitter<void>();
  @Output() importFromPdf = new EventEmitter<void>();
  @Output() retry = new EventEmitter<void>();

  get headline(): string {
    switch (this.mode) {
      case 'filtered':
        return 'No loads match your filters';
      case 'no-loads':
        return 'Your first load is one click away';
      case 'smart-filter-celebrate':
        return `Good news! No ${this.smartFilterLabel || 'matching'} loads right now.`;
      case 'api-error':
        return 'We couldn’t load your loads';
      case 'permission-denied':
        return 'You don’t have access to loads';
      default:
        return '';
    }
  }

  get subtext(): string {
    switch (this.mode) {
      case 'filtered':
        return 'Try widening your filters or clearing them to see everything.';
      case 'no-loads':
        return 'Create a load manually or drop a rate confirmation PDF to extract one automatically.';
      case 'smart-filter-celebrate':
        return 'Nothing to action in this smart filter. Check back later or switch filters.';
      case 'api-error':
        return 'A network or server hiccup got in the way. Try again in a moment.';
      case 'permission-denied':
        return 'Ask a dispatcher or admin on your team to grant you load access.';
      default:
        return '';
    }
  }

  get iconName(): string {
    switch (this.mode) {
      case 'filtered':
        return 'filter_alt_off';
      case 'no-loads':
        return 'local_shipping';
      case 'smart-filter-celebrate':
        return 'celebration';
      case 'api-error':
        return 'cloud_off';
      case 'permission-denied':
        return 'lock';
      default:
        return 'info';
    }
  }

  onClearFilters(): void {
    this.clearFilters.emit();
  }

  onCreateLoad(): void {
    this.createLoad.emit();
  }

  onImportFromPdf(): void {
    this.importFromPdf.emit();
  }

  onRetry(): void {
    this.retry.emit();
  }
}
