import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostBinding,
  Input,
  Output
} from '@angular/core';

export type ConfidenceTier = 'high' | 'medium' | 'low';

/**
 * FN-818 — reusable AI confidence chip.
 *
 * Summarises overall extraction confidence on draft loads. Colour and copy
 * are both derived from the confidence threshold:
 *   - ≥ 95 → green "✦ {n}% confidence"
 *   - 80–94 → yellow "✦ {n}% — review"
 *   - < 80 → orange "✦ {n}% — please verify"
 *
 * Parents wire `(click)` to open the detail drawer and focus low-confidence
 * fields (see FN-789 AC).
 */
@Component({
  selector: 'app-confidence-badge',
  templateUrl: './confidence-badge.component.html',
  styleUrls: ['./confidence-badge.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConfidenceBadgeComponent {
  /** 0–100 percentage. When null the badge does not render (guarded via *ngIf upstream). */
  @Input() confidence: number | null = null;

  /** Optional label override — falls back to tier-driven copy. */
  @Input() label: string | null = null;

  /** Optional hover tooltip. */
  @Input() tooltip: string | null = null;

  /** Emits on chip click so parents can open the drawer focused on low-confidence fields. */
  @Output() chipClick = new EventEmitter<MouseEvent>();

  @HostBinding('class.confidence-badge-host') hostClass = true;

  get tier(): ConfidenceTier {
    return ConfidenceBadgeComponent.tierFor(this.confidence);
  }

  /** Rounded percent for display. */
  get percent(): number | null {
    if (this.confidence == null || !Number.isFinite(this.confidence)) return null;
    return Math.round(this.confidence);
  }

  get computedLabel(): string {
    if (this.label) return this.label;
    const pct = this.percent;
    if (pct == null) return 'AI';
    switch (this.tier) {
      case 'high':   return `${pct}% confidence`;
      case 'medium': return `${pct}% — review`;
      case 'low':    return `${pct}% — please verify`;
    }
  }

  static tierFor(confidence: number | null | undefined): ConfidenceTier {
    if (confidence == null || !Number.isFinite(confidence)) return 'medium';
    if (confidence >= 95) return 'high';
    if (confidence >= 80) return 'medium';
    return 'low';
  }

  onClick(event: MouseEvent): void {
    event.stopPropagation();
    this.chipClick.emit(event);
  }
}
