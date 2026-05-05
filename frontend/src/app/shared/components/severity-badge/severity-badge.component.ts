import {
  ChangeDetectionStrategy,
  Component,
  HostBinding,
  Input
} from '@angular/core';
import { CommonModule } from '@angular/common';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
};

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low'
};

/**
 * FN-1326 — reusable severity chip for the unified Action Queue and any other
 * alert surface. Reads tokens from `--sev-{tier}-fg/bg/border` defined in
 * global styles so a downstream surface theme automatically applies.
 */
@Component({
  selector: 'app-severity-badge',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './severity-badge.component.html',
  styleUrls: ['./severity-badge.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SeverityBadgeComponent {
  @Input() severity: Severity = 'medium';

  /** Optional override; falls back to the capitalized severity name. */
  @Input() label: string | null = null;

  /** Hide the leading pip dot (use when the parent renders its own pip column). */
  @Input() showPip = true;

  @HostBinding('class.severity-badge-host') readonly hostClass = true;

  get computedLabel(): string {
    return this.label ?? SEVERITY_LABELS[this.severity];
  }

  static rank(severity: Severity | null | undefined): number {
    if (!severity) return Number.MAX_SAFE_INTEGER;
    return SEVERITY_RANK[severity] ?? Number.MAX_SAFE_INTEGER;
  }
}
