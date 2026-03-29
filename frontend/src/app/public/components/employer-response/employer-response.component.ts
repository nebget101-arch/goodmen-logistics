import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';

export interface EmployerResponseContext {
  driverName: string;
  oeName: string;
  oeAddress: string;
  oeDotNumber: string;
  employerName: string;
}

export interface AccidentRow {
  date: string;
  location: string;
  towAway: boolean;
  injuries: boolean;
  fatalities: boolean;
  hazmatSpill: boolean;
}

@Component({
  selector: 'app-employer-response',
  templateUrl: './employer-response.component.html',
  styleUrls: ['./employer-response.component.css']
})
export class EmployerResponseComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private baseUrl = environment.apiUrl.replace(/\/api\/?$/, '');

  tokenId = '';
  loading = true;
  error = '';
  submitted = false;
  submitting = false;

  context: EmployerResponseContext | null = null;

  // Quick exit
  noSafetyHistory = false;

  // Section A: Employment Verification
  wasEmployed = '';
  employedAs = '';
  employmentFrom = '';
  employmentTo = '';
  droveCmv = '';
  vehicleTypes: string[] = [];
  reasonForLeaving = '';

  vehicleTypeOptions = [
    'Straight Truck',
    'Tractor-Semitrailer',
    'Tractor-Two Trailers',
    'Motorcoach / Bus',
    'Tanker',
    'Flatbed',
    'Van / Box Truck',
    'Other'
  ];

  // Section B: Accidents
  noAccidentData = false;
  accidents: AccidentRow[] = [];
  otherAccidentRemarks = '';

  // Section C: Drug & Alcohol
  positiveDrugTests = '';
  positiveDrugTestDetails = '';
  alcoholViolation = '';
  alcoholViolationDetails = '';
  testRefusals = '';
  testRefusalDetails = '';
  returnToDuty = '';
  returnToDutyDetails = '';

  // Section D: Completion
  completedByName = '';
  completedByTitle = '';
  otherRemarks = '';

  // Result
  resultDocumentId = '';

  constructor(
    private route: ActivatedRoute,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    this.tokenId = this.route.snapshot.paramMap.get('tokenId') || '';
    if (!this.tokenId) {
      this.loading = false;
      this.error = 'Missing or invalid response link. Please use the link sent to you via email.';
      return;
    }
    this.loadContext();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadContext(): void {
    this.http.get<EmployerResponseContext>(
      `${this.baseUrl}/public/employer-investigations/${this.tokenId}`
    ).pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.context = res;
          this.loading = false;
        },
        error: (err) => {
          this.loading = false;
          this.error = err?.error?.message
            || 'Unable to load investigation details. The link may be invalid or expired.';
        }
      });
  }

  toggleVehicleType(type: string): void {
    const idx = this.vehicleTypes.indexOf(type);
    if (idx >= 0) {
      this.vehicleTypes.splice(idx, 1);
    } else {
      this.vehicleTypes.push(type);
    }
  }

  isVehicleTypeSelected(type: string): boolean {
    return this.vehicleTypes.includes(type);
  }

  addAccident(): void {
    this.accidents.push({
      date: '',
      location: '',
      towAway: false,
      injuries: false,
      fatalities: false,
      hazmatSpill: false
    });
  }

  removeAccident(index: number): void {
    this.accidents.splice(index, 1);
  }

  submitResponse(): void {
    if (this.submitting) return;

    // Validate required fields
    if (!this.completedByName.trim()) {
      this.error = 'Please enter your name in the Certification section.';
      return;
    }
    if (!this.completedByTitle.trim()) {
      this.error = 'Please enter your title in the Certification section.';
      return;
    }

    this.submitting = true;
    this.error = '';

    const body = {
      noSafetyHistory: this.noSafetyHistory,
      employmentVerification: {
        wasEmployed: this.wasEmployed,
        employedAs: this.employedAs,
        employmentFrom: this.employmentFrom,
        employmentTo: this.employmentTo,
        droveCmv: this.droveCmv,
        vehicleTypes: this.vehicleTypes,
        reasonForLeaving: this.reasonForLeaving
      },
      accidentHistory: {
        noAccidentData: this.noAccidentData,
        accidents: this.accidents,
        otherAccidentRemarks: this.otherAccidentRemarks
      },
      drugAlcoholHistory: {
        positiveDrugTests: this.positiveDrugTests,
        positiveDrugTestDetails: this.positiveDrugTestDetails,
        alcoholViolation: this.alcoholViolation,
        alcoholViolationDetails: this.alcoholViolationDetails,
        testRefusals: this.testRefusals,
        testRefusalDetails: this.testRefusalDetails,
        returnToDuty: this.returnToDuty,
        returnToDutyDetails: this.returnToDutyDetails
      },
      certification: {
        completedByName: this.completedByName,
        completedByTitle: this.completedByTitle,
        otherRemarks: this.otherRemarks,
        completedAt: new Date().toISOString()
      }
    };

    this.http.post<{ documentId: string }>(
      `${this.baseUrl}/public/employer-investigations/${this.tokenId}/respond`,
      body
    ).pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.submitting = false;
          this.submitted = true;
          this.resultDocumentId = res?.documentId || '';
        },
        error: (err) => {
          this.submitting = false;
          this.error = err?.error?.message || 'Failed to submit response. Please try again.';
        }
      });
  }
}
