import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostListener,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subject, Subscription } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import {
  ExplainPanelState,
  ExplainResponse,
  ExplainService,
  ExplainSource,
  ExplainRule,
  ExplainScore,
} from '../../../services/explain.service';

type SectionKey = 'sources' | 'rules' | 'scores';

/**
 * FN-1179 — Drill-down explanation side panel.
 *
 * Singleton panel mounted at the app root. Subscribes to ExplainService.state$;
 * when a token is published (via [appAiExplainable] click), slides in from the
 * right and renders the rationale: sources, rules, scores. Each section is
 * collapsible. Source rows can carry a `link` so users can jump to the
 * underlying record without losing the panel.
 *
 * Accessibility: backdrop click + Esc close the panel, sections use button
 * controls with aria-expanded.
 */
@Component({
  selector: 'app-explain-panel',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './explain-panel.component.html',
  styleUrls: ['./explain-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExplainPanelComponent implements OnInit, OnDestroy {
  state: ExplainPanelState | null = null;
  response: ExplainResponse | null = null;
  loading = false;
  /** Set to a friendly message when the fetch fails (incl. 404 for expired tokens). */
  errorMessage: string | null = null;

  collapsed: Record<SectionKey, boolean> = {
    sources: false,
    rules: false,
    scores: false,
  };

  private readonly destroy$ = new Subject<void>();
  private fetchSub?: Subscription;

  constructor(
    private readonly explain: ExplainService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.explain.state$
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => {
        this.state = state;
        if (state) {
          this.fetch(state.token);
        } else {
          this.response = null;
          this.errorMessage = null;
          this.loading = false;
          this.fetchSub?.unsubscribe();
        }
        this.cdr.markForCheck();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.fetchSub?.unsubscribe();
  }

  close(): void {
    this.explain.close();
  }

  retry(): void {
    if (this.state) this.fetch(this.state.token);
  }

  toggle(key: SectionKey): void {
    this.collapsed[key] = !this.collapsed[key];
  }

  trackBySource(_i: number, s: ExplainSource): string {
    return s.id ?? s.label;
  }

  trackByRule(_i: number, r: ExplainRule): string {
    return r.id ?? r.label;
  }

  trackByScore(_i: number, s: ExplainScore): string {
    return s.label;
  }

  /** Render a 0-1 score as a percent string. */
  scorePercent(value: number): number {
    if (!Number.isFinite(value)) return 0;
    const pct = Math.max(0, Math.min(1, value)) * 100;
    return Math.round(pct);
  }

  /** Render expiry as a short date — falls back to ISO if invalid. */
  expiryLabel(): string | null {
    const iso = this.response?.expiresAt;
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.state) this.close();
  }

  private fetch(token: string): void {
    this.loading = true;
    this.errorMessage = null;
    this.response = null;
    this.cdr.markForCheck();

    this.fetchSub?.unsubscribe();
    this.fetchSub = this.explain
      .getExplanation(token)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.response = res;
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.loading = false;
          const status = err?.status;
          if (status === 404 || status === 410) {
            this.errorMessage =
              'This explanation is no longer available. Tokens expire after 30 days.';
          } else {
            this.errorMessage =
              'Unable to load this explanation right now. Try again in a moment.';
          }
          this.cdr.markForCheck();
        },
      });
  }
}
