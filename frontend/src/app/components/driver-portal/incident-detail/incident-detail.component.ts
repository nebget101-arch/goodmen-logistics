import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../shared/toast/toast.service';
import { StepperStep } from '../../../shared/status-stepper/status-stepper.component';

interface IncidentImage {
  id: string;
  url: string;
  uploaded_at: string;
  mime_type: string;
}

interface TimelineEvent {
  type: string;
  occurred_at: string;
  description?: string;
}

export interface IncidentDetail {
  id: string;
  incident_number?: string;
  status: string;
  issue_type?: string;
  incident_summary?: string;
  created_at: string;
  updated_at?: string;
  driver_id?: string;
  driver_name?: string;
  vehicle_unit?: string;
  images?: IncidentImage[];
  driver_feedback?: string;
  driver_rating?: number;
  closed_at?: string;
  events?: TimelineEvent[];
}

type IncidentStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

@Component({
  selector: 'app-incident-detail',
  templateUrl: './incident-detail.component.html',
  styleUrls: ['./incident-detail.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IncidentDetailComponent implements OnInit, OnDestroy {
  incident: IncidentDetail | null = null;
  loading = true;
  errorMessage = '';
  incidentId = '';

  stepperSteps: StepperStep[] = [];
  activeStepKey = '';

  private destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private apiService: ApiService,
    private toast: ToastService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.incidentId = this.route.snapshot.paramMap.get('id') || '';
    if (this.incidentId) {
      this.loadIncident();
    } else {
      this.errorMessage = 'No incident ID provided.';
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadIncident(): void {
    this.loading = true;
    this.errorMessage = '';
    this.cdr.markForCheck();

    this.apiService.getSafetyIncidentById(this.incidentId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data: IncidentDetail) => {
          this.incident = data;
          this.buildStepperSteps(data);
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: (err: any) => {
          this.errorMessage = err?.error?.error || 'Failed to load incident details.';
          this.loading = false;
          this.cdr.markForCheck();
        },
      });
  }

  onPhotoUploaded(): void {
    this.toast.success('Photo uploaded successfully.');
    this.loadIncident();
  }

  onFeedbackSubmitted(): void {
    this.toast.success('Feedback submitted. Thank you!');
    this.loadIncident();
  }

  goBack(): void {
    this.router.navigate(['/driver-portal']);
  }

  getStatusLabel(status: string): string {
    switch ((status || '').toUpperCase() as IncidentStatus) {
      case 'OPEN': return 'Open';
      case 'IN_PROGRESS': return 'In Progress';
      case 'RESOLVED': return 'Resolved';
      case 'CLOSED': return 'Closed';
      default: return status || 'Unknown';
    }
  }

  getStatusClass(status: string): string {
    switch ((status || '').toUpperCase() as IncidentStatus) {
      case 'OPEN': return 'status-open';
      case 'IN_PROGRESS': return 'status-in-progress';
      case 'RESOLVED': return 'status-resolved';
      case 'CLOSED': return 'status-closed';
      default: return 'status-default';
    }
  }

  get isClosed(): boolean {
    const s = (this.incident?.status || '').toUpperCase();
    return s === 'CLOSED' || s === 'RESOLVED';
  }

  get showFeedbackForm(): boolean {
    return this.isClosed && !this.incident?.driver_feedback;
  }

  get hasFeedback(): boolean {
    return !!(this.incident?.driver_feedback);
  }

  get images(): IncidentImage[] {
    return this.incident?.images || [];
  }

  get stars(): number[] {
    return [1, 2, 3, 4, 5];
  }

  trackImageById(_index: number, img: IncidentImage): string {
    return img.id;
  }

  private buildStepperSteps(incident: IncidentDetail): void {
    const statusOrder: IncidentStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
    const labelMap: Record<IncidentStatus, string> = {
      OPEN: 'Reported',
      IN_PROGRESS: 'In Progress',
      RESOLVED: 'Resolved',
      CLOSED: 'Closed',
    };
    const currentStatus = (incident.status || '').toUpperCase() as IncidentStatus;
    const currentIndex = statusOrder.indexOf(currentStatus);

    this.stepperSteps = statusOrder.map((key, i) => ({
      key,
      label: labelMap[key],
      kicker: `Step ${i + 1}`,
      status: i < currentIndex ? 'complete' : i === currentIndex ? 'current' : 'pending',
    }));
    this.activeStepKey = currentStatus;
  }
}
