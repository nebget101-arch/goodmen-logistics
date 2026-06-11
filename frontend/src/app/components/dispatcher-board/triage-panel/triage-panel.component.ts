import {
  ChangeDetectorRef,
  Component,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges
} from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { TriageRecord, TriageService } from '../../../services/triage.service';

@Component({
  selector: 'app-triage-panel',
  templateUrl: './triage-panel.component.html',
  styleUrls: ['./triage-panel.component.scss']
})
export class TriagePanelComponent implements OnInit, OnChanges, OnDestroy {
  @Input() incidentId!: string;

  triage: TriageRecord | null = null;
  loading = false;
  errorMessage = '';
  showOverrideModal = false;

  private destroy$ = new Subject<void>();

  constructor(
    private triageService: TriageService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    if (this.incidentId) {
      this.loadTriage();
      this.emitPanelView();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['incidentId'] && !changes['incidentId'].firstChange && this.incidentId) {
      this.loadTriage();
      this.emitPanelView();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadTriage(): void {
    this.loading = true;
    this.errorMessage = '';
    this.triage = null;
    this.triageService.getTriage(this.incidentId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (record) => {
          this.triage = record;
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.loading = false;
          this.errorMessage = 'Failed to load triage data.';
          this.cdr.markForCheck();
        }
      });
  }

  openOverrideModal(): void {
    this.emitOverrideClick();
    this.showOverrideModal = true;
  }

  onOverrideComplete(record: TriageRecord): void {
    this.triage = record;
    this.showOverrideModal = false;
    this.cdr.markForCheck();
  }

  onOverrideCancelled(): void {
    this.showOverrideModal = false;
  }

  severityClass(severity: string | undefined): string {
    const s = (severity || '').toUpperCase();
    if (s === 'CRITICAL') return 'badge badge--critical';
    if (s === 'HIGH') return 'badge badge--high';
    if (s === 'MEDIUM') return 'badge badge--medium';
    return 'badge badge--low';
  }

  urgencyClass(urgency: string | undefined): string {
    const u = (urgency || '').toUpperCase();
    if (u === 'EMERGENCY') return 'badge badge--critical';
    if (u === 'URGENT') return 'badge badge--high';
    return 'badge badge--low';
  }

  private emitPanelView(): void {
    try {
      (window as any).__fn_telemetry?.track('triage_panel_view', { incident_id: this.incidentId });
    } catch (_) {}
  }

  private emitOverrideClick(): void {
    try {
      (window as any).__fn_telemetry?.track('triage_override_click', { incident_id: this.incidentId });
    } catch (_) {}
  }
}
