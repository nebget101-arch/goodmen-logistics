import { ChangeDetectionStrategy, Component, HostBinding, Input } from '@angular/core';

/**
 * FN-1636 — shimmer placeholder for loading states. Replaces the bespoke
 * orbital-loader on the dashboard and is reusable everywhere else.
 *
 * Announces `aria-busy="true"` and `aria-label="Loading"` on the host so
 * screen readers report the pending region.
 */
@Component({
  selector: 'app-ai-skeleton',
  templateUrl: './ai-skeleton.component.html',
  styleUrls: ['./ai-skeleton.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AiSkeletonComponent {
  /** Width as a CSS length. Bare numbers are treated as px. */
  @Input() width: string | number = '100%';

  /** Height as a CSS length. Bare numbers are treated as px. */
  @Input() height: string | number = '16px';

  /** Corner radius as a CSS length. Bare numbers are treated as px. */
  @Input() radius: string | number = '8px';

  @HostBinding('attr.aria-busy') readonly ariaBusy = 'true';
  @HostBinding('attr.aria-label') readonly ariaLabel = 'Loading';
  @HostBinding('attr.role') readonly role = 'status';

  /** Normalizes a length input: numbers (and numeric strings) become px. */
  static toCssLength(value: string | number): string {
    if (typeof value === 'number') {
      return `${value}px`;
    }
    return /^\d+(\.\d+)?$/.test(value.trim()) ? `${value.trim()}px` : value;
  }

  get cssWidth(): string {
    return AiSkeletonComponent.toCssLength(this.width);
  }

  get cssHeight(): string {
    return AiSkeletonComponent.toCssLength(this.height);
  }

  get cssRadius(): string {
    return AiSkeletonComponent.toCssLength(this.radius);
  }
}
