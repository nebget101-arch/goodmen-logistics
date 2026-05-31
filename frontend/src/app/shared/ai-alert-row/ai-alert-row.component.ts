import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

/** Alert severity — drives the pip color and the accessible severity word. */
export type AlertSeverity = 'good' | 'info' | 'warning' | 'critical';

/**
 * FN-1636 — single alert row for the alerts rail. Shows a severity pip with
 * an accessible label, the category/message/date, and two `.btn-icon`
 * actions (acknowledge, snooze) on the right. When `routerLink` is set the
 * message becomes a link; the action buttons never trigger navigation.
 */
@Component({
  selector: 'app-ai-alert-row',
  templateUrl: './ai-alert-row.component.html',
  styleUrls: ['./ai-alert-row.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AiAlertRowComponent {
  /** Severity tint + accessible severity word. */
  @Input() severity: AlertSeverity = 'info';

  /** Short category tag, e.g. "Compliance". */
  @Input() category = '';

  /** Human-readable alert text. */
  @Input() message = '';

  /** Display date/time string. */
  @Input() date = '';

  /** Optional link the message points to. */
  @Input() routerLink: string | unknown[] | null = null;

  /** Emits when the acknowledge action is pressed. */
  @Output() acknowledge = new EventEmitter<void>();

  /** Emits when the snooze action is pressed. */
  @Output() snooze = new EventEmitter<void>();

  /** Spoken severity word for the pip's screen-reader label. */
  get severityLabel(): string {
    switch (this.severity) {
      case 'critical':
        return 'Critical';
      case 'warning':
        return 'Warning';
      case 'good':
        return 'Resolved';
      default:
        return 'Info';
    }
  }

  onAcknowledge(event: Event): void {
    event.stopPropagation();
    this.acknowledge.emit();
  }

  onSnooze(event: Event): void {
    event.stopPropagation();
    this.snooze.emit();
  }
}
