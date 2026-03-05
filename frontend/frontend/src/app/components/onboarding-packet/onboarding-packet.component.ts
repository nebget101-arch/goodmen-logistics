import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api.service';

export interface EmploymentForm {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  dateOfBirth?: string;
  ssnLast4?: string;
  dateOfApplication?: string;
  positionAppliedFor?: string;
  dateAvailable?: string;
  canWorkInUs?: boolean | null;
  addressStreet?: string;
  addressCity?: string;
  addressState?: string;
  addressZip?: string;
  yearsAtAddress?: string;
  licenseState?: string;
  licenseNumber?: string;
  licenseClass?: string;
  licenseEndorsements?: string;
  licenseExpiry?: string;
  drivingExperienceSummary?: string;
  currentEmployerName?: string;
  currentEmployerPhone?: string;
  currentEmployerFrom?: string;
  currentEmployerTo?: string;
  currentEmployerReasonForLeaving?: string;
  previousEmployerName?: string;
  previousEmployerPhone?: string;
  previousEmployerFrom?: string;
  previousEmployerTo?: string;
  previousEmployerReasonForLeaving?: string;
  educationSummary?: string;
  otherQualifications?: string;
  applicationSignatureName?: string;
  applicationSignatureDate?: string;
}

export interface MvrForm {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  akaNames?: string;
  dateOfBirth?: string;
  driverLicenseNumber?: string;
  driverLicenseState?: string;
  emailForReportCopy?: string;
  acknowledgesRights?: boolean;
  mvrSignatureName?: string;
  mvrSignatureDate?: string;
}

@Component({
  selector: 'app-onboarding-packet',
  templateUrl: './onboarding-packet.component.html',
  styleUrls: ['./onboarding-packet.component.css']
})
export class OnboardingPacketComponent implements OnInit {
  packetId: string | null;
  token: string | null;

  loading = true;
  errorMessage: string | null = null;
  driver: any = null;
  sections: { section_key: string; status: string; completed_at?: string }[] = [];
  currentStep: 'employment_application' | 'mvr_authorization' = 'employment_application';
  saving = false;
  saveSuccess: string | null = null;

  employment: EmploymentForm = {};
  mvr: MvrForm = {};

  constructor(
    private route: ActivatedRoute,
    private apiService: ApiService
  ) {
    this.packetId = this.route.snapshot.paramMap.get('packetId');
    this.token = this.route.snapshot.queryParamMap.get('token');
  }

  ngOnInit(): void {
    this.loadPacket();
  }

  loadPacket(): void {
    if (!this.packetId || !this.token) {
      this.loading = false;
      this.errorMessage = 'Missing packet link or token. Use the link sent to you.';
      return;
    }
    this.apiService.getPublicOnboardingPacket(this.packetId, this.token).subscribe({
      next: (res) => {
        this.loading = false;
        this.driver = res.driver || null;
        this.sections = res.sections || [];
        this.hydrateFromSections();
      },
      error: (err) => {
        this.loading = false;
        this.errorMessage = err?.error?.message || 'Failed to load onboarding packet. The link may be invalid or expired.';
      }
    });
  }

  private hydrateFromSections(): void {
    const ea = this.sections.find((s) => s.section_key === 'employment_application');
    const eaData = (ea as unknown as { data?: EmploymentForm })?.data;
    if (eaData) {
      this.employment = { ...eaData };
    }
    const mvrSection = this.sections.find((s) => s.section_key === 'mvr_authorization');
    const mvrData = (mvrSection as unknown as { data?: MvrForm })?.data;
    if (mvrData) {
      this.mvr = { ...mvrData };
    }
  }

  setStep(step: 'employment_application' | 'mvr_authorization'): void {
    this.currentStep = step;
    this.saveSuccess = null;
  }

  isSectionCompleted(sectionKey: string): boolean {
    return this.sections.some((s) => s.section_key === sectionKey && s.status === 'completed');
  }

  submitEmploymentApplication(): void {
    if (!this.packetId || !this.token) return;
    this.saving = true;
    this.saveSuccess = null;
    this.errorMessage = null;
    this.apiService
      .saveOnboardingSection(
        this.packetId,
        'employment_application',
        this.employment,
        'completed',
        this.token
      )
      .subscribe({
        next: () => {
          this.saving = false;
          this.saveSuccess = 'Employment application saved successfully.';
          const idx = this.sections.findIndex((s) => s.section_key === 'employment_application');
          if (idx >= 0) {
            this.sections = this.sections.map((s, i) =>
              i === idx ? { ...s, status: 'completed', completed_at: new Date().toISOString() } : s
            );
          } else {
            this.sections = [...this.sections, { section_key: 'employment_application', status: 'completed', completed_at: new Date().toISOString() }];
          }
        },
        error: (err) => {
          this.saving = false;
          this.errorMessage = err?.error?.message || 'Failed to save employment application.';
        }
      });
  }

  submitMvrAuthorization(): void {
    if (!this.packetId || !this.token) return;
    this.saving = true;
    this.saveSuccess = null;
    this.errorMessage = null;
    this.apiService
      .saveOnboardingSection(
        this.packetId,
        'mvr_authorization',
        this.mvr,
        'completed',
        this.token
      )
      .subscribe({
        next: () => {
          this.saving = false;
          this.saveSuccess = 'MVR authorization saved successfully.';
          const idx = this.sections.findIndex((s) => s.section_key === 'mvr_authorization');
          if (idx >= 0) {
            this.sections = this.sections.map((s, i) =>
              i === idx ? { ...s, status: 'completed', completed_at: new Date().toISOString() } : s
            );
          } else {
            this.sections = [...this.sections, { section_key: 'mvr_authorization', status: 'completed', completed_at: new Date().toISOString() }];
          }
        },
        error: (err) => {
          this.saving = false;
          this.errorMessage = err?.error?.message || 'Failed to save MVR authorization.';
        }
      });
  }
}
