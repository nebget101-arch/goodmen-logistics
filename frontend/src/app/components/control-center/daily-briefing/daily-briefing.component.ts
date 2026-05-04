import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
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

@Component({
  selector: 'app-daily-briefing',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './daily-briefing.component.html',
  styleUrls: ['./daily-briefing.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DailyBriefingComponent implements OnInit, OnDestroy {
  response: DailyBriefingResponse | null = null;
  loading = true;
  refreshing = false;
  errorMessage: string | null = null;

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
}
