import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostBinding,
  Input,
  Output
} from '@angular/core';
import { CommonModule } from '@angular/common';

export type ConfidenceTier = 'high' | 'medium' | 'low';

/**
 * FN-887 — per-field confidence tier for AI-Extract wizard fields.
 * Maps `LoadAiEndpointExtraction.fieldConfidences[field]` (0–1 range).
 *
 *   - `red`:   score < 0.6   — "Needs review"
 *   - `amber`: 0.6 ≤ score < 0.85 — "Verify"
 *   - `none`:  score ≥ 0.85 (badge hidden)
 */
export type FieldConfidenceTier = 'red' | 'amber' | 'none';

export type ConfidenceBadgeVariant = 'card' | 'field';

/**
 * FN-818 — reusable AI confidence chip (card variant).
 * FN-887 — per-field variant next to wizard field labels.
 *
 * `variant="card"` (default) — card-level chip on draft loads:
 *   - ≥ 95 → green "✦ {n}% confidence"
 *   - 80–94 → yellow "✦ {n}% — review"
 *   - < 80 → orange "✦ {n}% — please verify"
 *
 * `variant="field"` — small inline pill next to a wizard field label,
 * driven by the `score` input (0–1 range from `fieldConfidences`):
 *   - < 0.6 → red "Needs review"
 *   - 0.6–0.85 → amber "Verify"
 *   - ≥ 0.85 → nothing rendered
 *
 * Parents wire card-variant `(click)` to open the detail drawer. Field
 * variant is presentational only (hover-tooltip with rounded percent).
 */
@Component({
  selector: 'app-confidence-badge',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './confidence-badge.component.html',
  styleUrls: ['./confidence-badge.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConfidenceBadgeComponent {
  /** Display variant. Defaults to the FN-818 card chip. */
  @Input() variant: ConfidenceBadgeVariant = 'card';

  /** Card variant: 0–100 percentage. */
  @Input() confidence: number | null = null;

  /** Field variant: 0–1 score from `fieldConfidences[field]`. */
  @Input() score: number | null = null;

  /** Optional label override — falls back to tier-driven copy. */
  @Input() label: string | null = null;

  /** Optional hover tooltip. */
  @Input() tooltip: string | null = null;

  /** Emits on chip click so parents can open the drawer focused on low-confidence fields. */
  @Output() chipClick = new EventEmitter<MouseEvent>();

  @HostBinding('class.confidence-badge-host') hostClass = true;
  @HostBinding('class.confidence-badge-host--field')
  get isFieldHost(): boolean { return this.variant === 'field'; }
  @HostBinding('class.confidence-badge-host--hidden')
  get isHidden(): boolean { return this.variant === 'field' && this.fieldTier === 'none'; }

  get tier(): ConfidenceTier {
    return ConfidenceBadgeComponent.tierFor(this.confidence);
  }

  get fieldTier(): FieldConfidenceTier {
    return ConfidenceBadgeComponent.fieldTierFor(this.score);
  }

  /** Rounded percent for display (card variant). */
  get percent(): number | null {
    if (this.confidence == null || !Number.isFinite(this.confidence)) return null;
    return Math.round(this.confidence);
  }

  /** Rounded percent for field-variant tooltip. */
  get fieldPercent(): number | null {
    if (this.score == null || !Number.isFinite(this.score)) return null;
    return Math.round(this.score * 100);
  }

  get computedLabel(): string {
    if (this.label) return this.label;
    if (this.variant === 'field') {
      switch (this.fieldTier) {
        case 'red':   return 'Needs review';
        case 'amber': return 'Verify';
        case 'none':  return '';
      }
    }
    const pct = this.percent;
    if (pct == null) return 'AI';
    switch (this.tier) {
      case 'high':   return `${pct}% confidence`;
      case 'medium': return `${pct}% — review`;
      case 'low':    return `${pct}% — please verify`;
    }
  }

  get computedTooltip(): string | null {
    if (this.tooltip) return this.tooltip;
    if (this.variant !== 'field') return null;
    const pct = this.fieldPercent;
    if (pct == null) return null;
    switch (this.fieldTier) {
      case 'red':   return `AI extracted this field at ${pct}% — please review before submitting.`;
      case 'amber': return `AI extracted this field at ${pct}% — double-check the value.`;
      case 'none':  return null;
    }
  }

  static tierFor(confidence: number | null | undefined): ConfidenceTier {
    if (confidence == null || !Number.isFinite(confidence)) return 'medium';
    if (confidence >= 95) return 'high';
    if (confidence >= 80) return 'medium';
    return 'low';
  }

  /** FN-887 — tier for per-field 0–1 scores. */
  static fieldTierFor(score: number | null | undefined): FieldConfidenceTier {
    if (score == null || !Number.isFinite(score)) return 'none';
    if (score < 0.6) return 'red';
    if (score < 0.85) return 'amber';
    return 'none';
  }

  onClick(event: MouseEvent): void {
    event.stopPropagation();
    this.chipClick.emit(event);
  }
}
