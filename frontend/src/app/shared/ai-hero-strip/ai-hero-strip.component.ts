import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { Params } from '@angular/router';

/** Severity drives chip color and the strip's dominant accent. */
export type HeroSeverity = 'info' | 'warning' | 'critical';

/** Computed dominant accent, including the empty "all nominal" state. */
export type HeroDominant = HeroSeverity | 'good';

/** One "needs attention" chip. */
export interface HeroItem {
  severity: HeroSeverity;
  count: number;
  label: string;
  routerLink: string | unknown[];
  queryParams?: Params;
}

/**
 * FN-1636 — one-line "needs attention" strip. Renders up to three severity
 * chips and computes a dominant accent from the highest severity present:
 * critical → red, warning → amber, info → cyan; empty → green
 * "All systems nominal". The right side exposes a `[heroAction]` slot for a
 * "View all" link. Built on the `.ai-panel-flat` utility.
 */
@Component({
  selector: 'app-ai-hero-strip',
  templateUrl: './ai-hero-strip.component.html',
  styleUrls: ['./ai-hero-strip.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AiHeroStripComponent {
  private static readonly RANK: Record<HeroSeverity, number> = {
    info: 1,
    warning: 2,
    critical: 3
  };

  /** Attention chips. Only the first three are rendered. */
  @Input() items: HeroItem[] = [];

  /** Computes the dominant severity from a list of items. */
  static dominantSeverity(items: HeroItem[] | null | undefined): HeroDominant {
    if (!items || items.length === 0) {
      return 'good';
    }
    return items.reduce<HeroDominant>((acc, item) => {
      if (acc === 'good') {
        return item.severity;
      }
      return AiHeroStripComponent.RANK[item.severity] > AiHeroStripComponent.RANK[acc as HeroSeverity]
        ? item.severity
        : acc;
    }, 'good');
  }

  /** At most three chips are shown. */
  get visibleItems(): HeroItem[] {
    return (this.items ?? []).slice(0, 3);
  }

  get dominant(): HeroDominant {
    return AiHeroStripComponent.dominantSeverity(this.items);
  }

  get isEmpty(): boolean {
    return this.dominant === 'good';
  }

  trackByLabel(_index: number, item: HeroItem): string {
    return item.label;
  }
}
