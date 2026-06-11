import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { RoadsideService } from '../../../services/roadside.service';

export type IncidentStatus = 'NEW' | 'TRIAGED' | 'DISPATCHED' | 'RESOLVED' | 'CANCELLED';

export interface DriverIncident {
  id: string;
  status: IncidentStatus;
  vehicle?: string;
  description?: string;
  location?: string;
  created_at: string;
}

type FilterStatus = IncidentStatus | 'ALL';

const STATUS_LABELS: Record<IncidentStatus, string> = {
  NEW: 'New',
  TRIAGED: 'Triaged',
  DISPATCHED: 'Dispatched',
  RESOLVED: 'Resolved',
  CANCELLED: 'Cancelled',
};

@Component({
  selector: 'app-incident-list',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './incident-list.component.html',
  styleUrls: ['./incident-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IncidentListComponent implements OnInit, OnDestroy {
  incidents: DriverIncident[] = [];
  loading = true;
  error = '';
  filterStatus: FilterStatus = 'ALL';

  readonly filterOptions: { value: FilterStatus; label: string }[] = [
    { value: 'ALL', label: 'All' },
    { value: 'NEW', label: 'New' },
    { value: 'TRIAGED', label: 'Triaged' },
    { value: 'DISPATCHED', label: 'Dispatched' },
    { value: 'RESOLVED', label: 'Resolved' },
  ];

  private destroy$ = new Subject<void>();

  constructor(
    private roadsideService: RoadsideService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get filteredIncidents(): DriverIncident[] {
    if (this.filterStatus === 'ALL') return this.incidents;
    return this.incidents.filter(i => i.status === this.filterStatus);
  }

  setFilter(status: FilterStatus): void {
    this.filterStatus = status;
    this.cdr.markForCheck();
  }

  timeSince(isoDate: string): string {
    const diffMs = Date.now() - new Date(isoDate).getTime();
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  statusLabel(status: IncidentStatus): string {
    return STATUS_LABELS[status] ?? status;
  }

  reload(): void {
    this.error = '';
    this.loading = true;
    this.cdr.markForCheck();
    this.load();
  }

  private load(): void {
    this.roadsideService
      .listCalls()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (resp: any) => {
          const raw: any[] = Array.isArray(resp) ? resp : (resp?.calls ?? resp?.data ?? []);
          this.incidents = raw.map((c: any): DriverIncident => ({
            id: c.id ?? c.call_id ?? '',
            status: (c.status as IncidentStatus) ?? 'NEW',
            vehicle: c.unit_number ?? c.vehicle ?? '',
            description: c.symptoms ?? c.description ?? '',
            location: c.location ?? '',
            created_at: c.created_at ?? c.createdAt ?? new Date().toISOString(),
          }));
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.error = 'Could not load incidents. Please try again.';
          this.loading = false;
          this.cdr.markForCheck();
        },
      });
  }
}
