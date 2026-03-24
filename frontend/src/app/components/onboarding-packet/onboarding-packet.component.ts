import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { SeoService } from '../../services/seo.service';
import { SEO_PUBLIC } from '../../services/seo-public-presets';
import { EmployerHistoryData } from './employer-history-tiered/employer-history-tiered.component';
import { DisqualificationData } from './disqualification-history/disqualification-history.component';

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
  employerHistory?: EmployerHistoryData;
  disqualificationHistory?: DisqualificationData;
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

export type PacketStep =
  | 'employment_application'
  | 'consent_forms'
  | 'mvr_authorization'
  | 'document_uploads'
  | 'review_submit';

export interface ConsentKeyConfig {
  key: string;
  label: string;
  icon: string;
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
  currentStep: PacketStep = 'employment_application';
  saving = false;
  reviewMode = false;
  submittedEmployment = false;
  saveSuccess: string | null = null;

  employment: EmploymentForm = {};
  mvr: MvrForm = {};

  consentKeys: ConsentKeyConfig[] = [
    { key: 'fcra_disclosure', label: 'FCRA Disclosure', icon: 'policy' },
    { key: 'fcra_authorization', label: 'FCRA Authorization', icon: 'verified_user' },
    { key: 'previous_employer_inquiry', label: 'Previous Employer Inquiry', icon: 'contact_phone' },
    { key: 'clearinghouse_full', label: 'Clearinghouse Full Query', icon: 'search' },
    { key: 'release_of_information', label: 'Release of Information', icon: 'share' }
  ];

  signedConsents: Set<string> = new Set();

  steps: { key: PacketStep; label: string; icon: string; sectionKey?: string }[] = [
    { key: 'employment_application', label: 'Employment Application', icon: 'description', sectionKey: 'employment_application' },
    { key: 'consent_forms', label: 'Consent Forms', icon: 'verified_user', sectionKey: 'consent_forms' },
    { key: 'mvr_authorization', label: 'MVR Authorization', icon: 'policy', sectionKey: 'mvr_authorization' },
    { key: 'document_uploads', label: 'Document Uploads', icon: 'upload_file', sectionKey: 'document_uploads' },
    { key: 'review_submit', label: 'Review & Submit', icon: 'fact_check' }
  ];

  constructor(
    private route: ActivatedRoute,
    private apiService: ApiService,
    private seo: SeoService
  ) {
    this.packetId = this.route.snapshot.paramMap.get('packetId');
    this.token = this.route.snapshot.queryParamMap.get('token');
  }

  ngOnInit(): void {
    const path = this.packetId ? `/onboard/${this.packetId}` : SEO_PUBLIC.driverOnboarding.path;
    this.seo.apply({ ...SEO_PUBLIC.driverOnboarding, path });
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
      this.employment = { ...this.employment, ...eaData };
    }
    const mvrSection = this.sections.find((s) => s.section_key === 'mvr_authorization');
    const mvrData = (mvrSection as unknown as { data?: MvrForm })?.data;
    if (mvrData) {
      this.mvr = { ...mvrData };
    }
    const consentSection = this.sections.find((s) => s.section_key === 'consent_forms');
    const consentData = (consentSection as unknown as { data?: { signedConsents?: string[] } })?.data;
    if (consentData?.signedConsents) {
      consentData.signedConsents.forEach((key) => this.signedConsents.add(key));
    }
  }

  setStep(step: PacketStep): void {
    this.currentStep = step;
    this.reviewMode = false;
    this.saveSuccess = null;
  }

  isSectionCompleted(sectionKey: string): boolean {
    if (sectionKey === 'consent_forms') {
      return this.consentKeys.every((c) => this.signedConsents.has(c.key));
    }
    return this.sections.some((s) => s.section_key === sectionKey && s.status === 'completed');
  }

  getSectionStatus(sectionKey: string): string {
    if (sectionKey === 'consent_forms') {
      const signed = this.consentKeys.filter((c) => this.signedConsents.has(c.key)).length;
      if (signed === this.consentKeys.length) return 'Completed';
      if (signed > 0) return `${signed}/${this.consentKeys.length} signed`;
      return 'Not started';
    }
    const section = this.sections.find((s) => s.section_key === sectionKey);
    if (!section) return 'Not started';
    if (section.status === 'completed') return 'Completed';
    if (section.status === 'in_progress') return 'In progress';
    return 'Not started';
  }

  onConsentSigned(consentKey: string): void {
    this.signedConsents = new Set(this.signedConsents).add(consentKey);
  }

  isConsentSigned(consentKey: string): boolean {
    return this.signedConsents.has(consentKey);
  }

  get allConsentsSigned(): boolean {
    return this.consentKeys.every((c) => this.signedConsents.has(c.key));
  }

  get packetReady(): boolean {
    return (
      this.isSectionCompleted('employment_application') &&
      this.allConsentsSigned
    );
  }

  onEmployerHistoryChange(data: EmployerHistoryData): void {
    this.employment = { ...this.employment, employerHistory: data };
  }

  onDisqualificationChange(data: DisqualificationData): void {
    this.employment = { ...this.employment, disqualificationHistory: data };
  }

  saveEmploymentDraft(): void {
    if (!this.packetId || !this.token) return;
    this.saving = true;
    this.saveSuccess = null;
    this.errorMessage = null;
    this.apiService
      .saveOnboardingSection(this.packetId, 'employment_application', this.employment, 'in_progress', this.token)
      .subscribe({
        next: () => {
          this.saving = false;
          this.saveSuccess = 'Draft saved. You can resume later from this same onboarding link.';
        },
        error: (err) => {
          this.saving = false;
          this.errorMessage = err?.error?.message || 'Failed to save draft.';
        }
      });
  }

  openReview(): void {
    this.reviewMode = true;
    this.saveSuccess = null;
  }

  backToEdit(): void {
    this.reviewMode = false;
  }

  submitEmploymentApplication(): void {
    if (!this.packetId || !this.token) return;
    this.saving = true;
    this.saveSuccess = null;
    this.errorMessage = null;
    this.apiService
      .saveOnboardingSection(this.packetId, 'employment_application', this.employment, 'completed', this.token)
      .subscribe({
        next: () => {
          this.saving = false;
          this.submittedEmployment = true;
          this.reviewMode = false;
          this.saveSuccess = 'Employment application submitted successfully. Your DQF employment checklist item will be updated automatically.';
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
    this.saveSuccess = 'MVR Authorization is not part of this phase yet. Placeholder only.';
  }

  submitFinalPacket(): void {
    this.saveSuccess = 'Final packet review submission is not yet implemented. All sections are tracked individually.';
  }
}
