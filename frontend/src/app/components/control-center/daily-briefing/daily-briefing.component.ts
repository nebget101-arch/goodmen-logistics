import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';

import {
  BriefingPayload,
  BriefingSection,
  BriefingService,
  DailyBriefingResponse,
} from '../../../services/briefing.service';

interface SectionView {
  id: keyof BriefingPayload;
  label: string;
  icon: 'flow' | 'alert' | 'driver' | 'vehicle' | 'spark';
}

/**
 * FN-1337: emitted when the briefing finishes loading so the parent can
 * collapse / restore the card. `hasBaseline=false` means the AI service has
 * not yet collected enough data to produce a useful briefing; in that case
 * `firstBaselineEta` (when present) is the ISO date the first baseline is
 * expected.
 */
export interface BriefingVisibility {
  hasBaseline: boolean;
  firstBaselineEta: string | null;
}

@Component({
  selector: 'app-daily-briefing',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './daily-briefing.component.html',
  styleUrls: ['./daily-briefing.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DailyBriefingComponent implements OnInit, OnDestroy {
  @Output() visibilityChange = new EventEmitter<BriefingVisibility>();

  response: DailyBriefingResponse | null = null;
  loading = true;
  refreshing = false;
  errorMessage: string | null = null;
  hasBaseline = true;
  firstBaselineEta: string | null = null;

  readonly sections: SectionView[] = [
    { id: 'throughput', label: 'Load throughput', icon: 'flow' },
    { id: 'exceptions', label: 'Exceptions', icon: 'alert' },
    { id: 'driverRisk', label: 'Top driver risk', icon: 'driver' },
    { id: 'vehicleRisk', label: 'Top vehicle risk', icon: 'vehicle' },
    { id: 'recommendedAction', label: 'Recommended action', icon: 'spark' },
  ];

  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly briefingService: BriefingService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.fetch(false);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  refresh(): void {
    if (this.refreshing) return;
    this.fetch(true);
  }

  trackBySection(_index: number, section: SectionView): string {
    return section.id;
  }

  getSection(id: SectionView['id']): BriefingSection | null {
    return this.response ? this.response.briefing[id] : null;
  }

  private fetch(isRefresh: boolean): void {
    this.errorMessage = null;
    if (isRefresh) {
      this.refreshing = true;
    } else {
      this.loading = true;
    }
    this.cdr.markForCheck();

    this.briefingService
      .getBriefing({ refresh: isRefresh })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.response = data;
          this.loading = false;
          this.refreshing = false;
          this.applyBaseline(data);
          this.cdr.markForCheck();
        },
        error: () => {
          this.errorMessage =
            'Briefing unavailable right now. Try refreshing in a moment.';
          this.loading = false;
          this.refreshing = false;
          this.cdr.markForCheck();
        },
      });
  }

  /**
   * Defaults to `hasBaseline=true` when the server omits the field — preserves
   * the pre-FN-1337 contract where every response is render-worthy.
   */
  private applyBaseline(data: DailyBriefingResponse): void {
    this.hasBaseline = data.hasBaseline !== false;
    this.firstBaselineEta = data.firstBaselineEta ?? null;
    this.visibilityChange.emit({
      hasBaseline: this.hasBaseline,
      firstBaselineEta: this.firstBaselineEta,
    });
  }
}
