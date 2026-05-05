import { Component, Input } from '@angular/core';

/**
 * FN-1099: Per-field confidence badge for AI-prefilled forms.
 *
 * Buckets — matching the FN-1097 vision-handler scale:
 *   high   ≥ 0.85   green
 *   medium 0.60–0.84 yellow
 *   low    < 0.60   red
 *
 * Pass `null`/`undefined` to render nothing (used when the field is
 * user-edited and the AI suggestion no longer applies).
 */
@Component({
  selector: 'app-confidence-badge',
  templateUrl: './confidence-badge.component.html',
  styleUrls: ['./confidence-badge.component.scss']
})
export class ConfidenceBadgeComponent {
  // Accept undefined so callers can pass `obj.field` without `?? null` boilerplate.
  // Angular's strict template checker requires the input type to explicitly
  // include undefined; the runtime default below is just a sentinel.
  @Input() confidence: number | null | undefined;

  get bucket(): 'high' | 'medium' | 'low' | null {
    const c = this.confidence;
    if (c === null || c === undefined || Number.isNaN(c)) return null;
    if (c >= 0.85) return 'high';
    if (c >= 0.6) return 'medium';
    return 'low';
  }

  get label(): string {
    switch (this.bucket) {
      case 'high':   return 'High';
      case 'medium': return 'Medium';
      case 'low':    return 'Low';
      default:       return '';
    }
  }

  get cssClass(): string {
    return this.bucket ? `confidence-badge--${this.bucket}` : '';
  }

  get pct(): string {
    if (this.confidence === null || this.confidence === undefined) return '';
    return `${Math.round(this.confidence * 100)}%`;
  }
}
