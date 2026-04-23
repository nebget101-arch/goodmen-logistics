import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostBinding,
  Input,
  Output
} from '@angular/core';

export type AiSparkleTier = 'high' | 'medium' | 'low';
export type AiSparkleSize = 'sm' | 'md';

/**
 * FN-818 — reusable AI extraction marker.
 *
 * Shows a ✦ icon with a shimmer animation to mark content that originated
 * from an AI extraction pipeline. The icon colour reflects overall or
 * per-field confidence; consumers can wire `(sparkleClick)` to surface
 * richer per-field info (e.g. tooltip / drawer focus).
 *
 * Tier thresholds (match FN-789 story spec):
 *   - high   (teal)   : confidence ≥ 95
 *   - medium (yellow) : 80 ≤ confidence < 95
 *   - low    (orange) : confidence < 80
 * A null/undefined confidence defaults to the `high` tier so the marker
 * still renders for AI-sourced content without per-field numbers.
 */
@Component({
  selector: 'app-ai-sparkle',
  templateUrl: './ai-sparkle.component.html',
  styleUrls: ['./ai-sparkle.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AiSparkleComponent {
  /** 0–100 percentage. When null we still show the sparkle (AI source without per-field score). */
  @Input() confidence: number | null = null;

  /** Native tooltip text. Parents can compose "Auto-extracted from …" copy here. */
  @Input() tooltip: string | null = null;

  @Input() size: AiSparkleSize = 'sm';

  /** Hides the glyph without removing it from layout (helpful when a parent clears edits). */
  @Input() visible = true;

  /** Emits when the glyph is clicked. Parents may open a per-field tooltip or the detail drawer. */
  @Output() sparkleClick = new EventEmitter<MouseEvent>();

  @HostBinding('class.ai-sparkle-host') hostClass = true;

  get tier(): AiSparkleTier {
    return AiSparkleComponent.tierFor(this.confidence);
  }

  static tierFor(confidence: number | null | undefined): AiSparkleTier {
    if (confidence == null || !Number.isFinite(confidence)) return 'high';
    if (confidence >= 95) return 'high';
    if (confidence >= 80) return 'medium';
    return 'low';
  }

  onClick(event: MouseEvent): void {
    event.stopPropagation();
    this.sparkleClick.emit(event);
  }
}
