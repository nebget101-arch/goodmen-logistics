import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostBinding,
  Input,
  Output
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Severity, SeverityBadgeComponent } from '../severity-badge/severity-badge.component';

export interface GroupedAlertAction {
  /** Visible button copy. */
  label: string;
  /** Optional aria-label override. */
  ariaLabel?: string;
}

/**
 * FN-1326 — reusable row for the unified Action Queue (FN-1322) and any other
 * grouped-alert surface. One row collapses N near-identical alerts into:
 * severity pip + badge, category, message, count chip, expand toggle, primary
 * CTA, and dismiss control. Expanded body is provided via `<ng-content>`
 * (e.g. the parent renders the list of affected targets).
 */
@Component({
  selector: 'app-grouped-alert-row',
  standalone: true,
  imports: [CommonModule, SeverityBadgeComponent],
  templateUrl: './grouped-alert-row.component.html',
  styleUrls: ['./grouped-alert-row.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GroupedAlertRowComponent {
  @Input() severity: Severity = 'medium';

  /** Short category tag, e.g. "Maintenance" or "HOS". */
  @Input() category: string | null = null;

  /** Human-readable summary of the grouped alert. */
  @Input() message = '';

  /**
   * Number of underlying alerts collapsed into this row. When > 1 a count chip
   * is rendered and the expand toggle becomes active.
   */
  @Input() count = 1;

  /** Optional unit noun for the count chip (defaults to no suffix). */
  @Input() countUnit: string | null = null;

  /** Primary CTA. When omitted the action button is not rendered. */
  @Input() primaryAction: GroupedAlertAction | null = null;

  /** Show the dismiss control. */
  @Input() dismissible = true;

  /** Two-way bound expanded state. */
  @Input() expanded = false;
  @Output() expandedChange = new EventEmitter<boolean>();

  /** Fired when the user activates the primary CTA. */
  @Output() primaryActionClick = new EventEmitter<void>();

  /** Fired when the user dismisses the entire group. */
  @Output() dismiss = new EventEmitter<void>();

  @HostBinding('class.grouped-alert-row-host') readonly hostClass = true;

  get isExpandable(): boolean {
    return this.count > 1;
  }

  get countLabel(): string {
    if (!this.countUnit) return String(this.count);
    return `${this.count} ${this.countUnit}`;
  }

  toggleExpanded(): void {
    if (!this.isExpandable) return;
    this.expanded = !this.expanded;
    this.expandedChange.emit(this.expanded);
  }

  onPrimaryAction(event: Event): void {
    event.stopPropagation();
    this.primaryActionClick.emit();
  }

  onDismiss(event: Event): void {
    event.stopPropagation();
    this.dismiss.emit();
  }
}
