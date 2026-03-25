import { Component, Input, OnInit, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil, finalize } from 'rxjs/operators';
import { AnnualComplianceService } from '../../../services/annual-compliance.service';
import {
  ComplianceItem,
  ComplianceItemStatus,
  ComplianceItemType,
} from '../../../models/annual-compliance.model';

@Component({
  selector: 'app-driver-compliance-section',
  templateUrl: './driver-compliance-section.component.html',
  styleUrls: ['./driver-compliance-section.component.css']
})
export class DriverComplianceSectionComponent implements OnInit, OnChanges, OnDestroy {
  @Input() driverId = '';

  private destroy$ = new Subject<void>();

  items: ComplianceItem[] = [];
  loading = true;
  error = '';
  saving = false;

  selectedYear: number = new Date().getFullYear();
  yearOptions: number[] = [];

  // Inline completion form
  completingItemId: string | null = null;
  completeForm!: FormGroup;

  determinationOptions = [
    { value: 'satisfactory', label: 'Satisfactory' },
    { value: 'conditional', label: 'Conditional' },
    { value: 'unsatisfactory', label: 'Unsatisfactory' },
  ];

  constructor(
    private complianceService: AnnualComplianceService,
    private fb: FormBuilder
  ) {
    const currentYear = new Date().getFullYear();
    this.yearOptions = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1];

    this.completeForm = this.fb.group({
      reviewerName: ['', Validators.required],
      determination: ['satisfactory', Validators.required],
      notes: [''],
    });
  }

  ngOnInit(): void {
    if (this.driverId) {
      this.loadCompliance();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['driverId'] && !changes['driverId'].firstChange) {
      this.loadCompliance();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadCompliance(): void {
    if (!this.driverId) return;
    this.loading = true;
    this.error = '';
    this.completingItemId = null;

    this.complianceService.getDriverCompliance(this.driverId, this.selectedYear)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.items = res.items || [];
          this.loading = false;
        },
        error: () => {
          this.error = 'Failed to load compliance items';
          this.loading = false;
        }
      });
  }

  onYearChange(): void {
    this.loadCompliance();
  }

  // ─── Completion ─────────────────────────────────────────────────────────────

  startComplete(item: ComplianceItem): void {
    this.completingItemId = item.id;
    this.completeForm.reset({
      reviewerName: '',
      determination: 'satisfactory',
      notes: '',
    });
  }

  cancelComplete(): void {
    this.completingItemId = null;
  }

  submitComplete(item: ComplianceItem): void {
    if (this.completeForm.invalid || this.saving) return;
    this.saving = true;

    this.complianceService.completeItem(item.id, this.completeForm.value)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => this.saving = false)
      )
      .subscribe({
        next: () => {
          this.completingItemId = null;
          this.loadCompliance();
        },
        error: () => { this.error = 'Failed to mark item as complete'; }
      });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  typeLabel(type: ComplianceItemType): string {
    const labels: Record<ComplianceItemType, string> = {
      mvr_inquiry: 'MVR Inquiry',
      driving_record_review: 'Driving Record Review',
      clearinghouse_query: 'Clearinghouse Query',
      medical_cert: 'Medical Certificate',
    };
    return labels[type] ?? type;
  }

  typeIcon(type: ComplianceItemType): string {
    const icons: Record<ComplianceItemType, string> = {
      mvr_inquiry: 'fact_check',
      driving_record_review: 'description',
      clearinghouse_query: 'search',
      medical_cert: 'medical_information',
    };
    return icons[type] ?? 'assignment';
  }

  statusLabel(status: ComplianceItemStatus): string {
    const labels: Record<ComplianceItemStatus, string> = {
      complete: 'Complete',
      due_soon: 'Due Soon',
      overdue: 'Overdue',
      pending: 'Pending',
    };
    return labels[status] ?? status;
  }

  statusClass(status: ComplianceItemStatus): string {
    return `chip-${status}`;
  }

  formatDate(dateStr: string | null): string {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}
