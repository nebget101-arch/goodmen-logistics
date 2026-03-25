import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { SeoService } from '../../services/seo.service';
import { SEO_PUBLIC } from '../../services/seo-public-presets';
import { EmployerHistoryData } from './employer-history-tiered/employer-history-tiered.component';
import { DisqualificationData } from './disqualification-history/disqualification-history.component';

export interface PreviousAddress {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  yearsAtAddress?: string;
}

export interface EmployerEntry {
  employerName?: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  positionHeld?: string;
  fromDate?: string;
  toDate?: string;
  contactPerson?: string;
  phoneNumber?: string;
  employerEmail?: string;
  salaryWage?: string;
  reasonForLeaving?: string;
  wasCMV?: boolean;
}

export interface AccidentEntry {
  date?: string;
  natureOfAccident?: string;
  fatalities?: string;
  injuries?: string;
  hazardousMaterialSpill?: boolean;
}

export interface ViolationEntry {
  location?: string;
  date?: string;
  charge?: string;
  penalty?: string;
}

export interface LicenseEntry {
  state?: string;
  licenseNumber?: string;
  type?: string;
  expirationDate?: string;
}

export interface DrivingExpEntry {
  hasExperience?: boolean;
  typeOfEquipment?: string;
  dateFrom?: string;
  dateTo?: string;
  approxMiles?: string;
  description?: string;
}

export interface EmploymentForm {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  dateOfBirth?: string;
  ssn?: string;
  ssnDisplay?: string;
  dateOfApplication?: string;
  positionAppliedFor?: string;

  // Current address
  addressStreet?: string;
  addressCity?: string;
  addressState?: string;
  addressZip?: string;
  yearsAtAddress?: string;
  previousAddresses?: PreviousAddress[];

  // Work authorization & background
  legallyAuthorizedToWork?: string;
  convictedOfFelony?: string;
  felonyDetails?: string;
  unableToPerformFunctions?: string;
  adaDetails?: string;

  // Employment history
  currentEmployer?: EmployerEntry;
  previousEmployers?: EmployerEntry[];

  // Accident record
  hasAccidents?: string;
  accidents?: AccidentEntry[];

  // Traffic violations
  hasViolations?: string;
  violations?: ViolationEntry[];

  // License history
  licenses?: LicenseEntry[];

  // Driving experience (questionnaire)
  straightTruck?: DrivingExpEntry;
  tractorSemiTrailer?: DrivingExpEntry;
  tractorTwoTrailers?: DrivingExpEntry;
  motorcoachSchoolBus?: DrivingExpEntry;
  motorcoachSchoolBusMore15?: DrivingExpEntry;
  otherEquipment?: DrivingExpEntry;
  statesOperatedIn?: string;

  // Drug and alcohol
  violatedSubstanceProhibitions?: string;
  failedRehabProgram?: string;
  alcoholTestResult04OrHigher?: string;
  positiveControlledSubstancesTest?: string;
  refusedRequiredTest?: string;
  otherDOTViolation?: string;

  // Legacy fields (kept for backward compat)
  educationSummary?: string;
  otherQualifications?: string;
  applicationSignatureName?: string;
  applicationSignatureDate?: string;
  employerHistory?: EmployerHistoryData;
  disqualificationHistory?: DisqualificationData;

  // Certification fields (FN-233)
  certificationFields?: {
    fullName?: string;
    dateOfBirth?: string;
    ssnLast4?: string;
    driversLicenseNumber?: string;
    stateOfIssue?: string;
    certifyTrueAndAccurate?: boolean;
    typedSignature?: string;
    signatureDate?: string;
  };

  // Legacy (mapped)
  ssnLast4?: string;
  canWorkInUs?: boolean | null;
  dateAvailable?: string;
  licenseState?: string;
  licenseNumber?: string;
  licenseClass?: string;
  licenseEndorsements?: string;
  licenseExpiry?: string;
  drivingExperienceSummary?: string;
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
  requiresSignature: boolean;
  captureFields: string[];
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

  employment: EmploymentForm = {
    previousAddresses: [],
    currentEmployer: {},
    previousEmployers: [],
    accidents: [],
    violations: [],
    licenses: [{}],
    straightTruck: {},
    tractorSemiTrailer: {},
    tractorTwoTrailers: {},
    motorcoachSchoolBus: {},
    motorcoachSchoolBusMore15: {},
    otherEquipment: {},
    certificationFields: {
      certifyTrueAndAccurate: false,
      signatureDate: new Date().toISOString().slice(0, 10)
    }
  };
  mvr: MvrForm = {};

  usStates = [
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
    'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
    'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
  ];

  ssnRaw = '';
  ssnMasked = true;
  totalResidencyYears = 0;
  needMoreAddresses = false;
  totalEmployerYears = 0;
  needMoreEmployers = false;

  consentKeys: ConsentKeyConfig[] = [
    { key: 'fcra_disclosure', label: 'FCRA Disclosure', icon: 'policy', requiresSignature: false, captureFields: [] },
    { key: 'fcra_authorization', label: 'FCRA Authorization', icon: 'verified_user', requiresSignature: true, captureFields: ['fullName', 'dateOfBirth', 'ssnLast4', 'driversLicenseNumber', 'stateOfIssue'] },
    { key: 'release_of_information', label: 'Release of Information Authorization (DQ & Safety)', icon: 'share', requiresSignature: true, captureFields: ['fullName', 'dateOfBirth', 'driversLicenseNumber', 'stateOfIssue'] },
    { key: 'drug_alcohol_release', label: 'Release of Information Authorization (Drug & Alcohol)', icon: 'local_pharmacy', requiresSignature: true, captureFields: ['fullName', 'dateOfBirth', 'driversLicenseNumber', 'stateOfIssue'] }
  ];

  signedConsents: Set<string> = new Set();
  expandedConsent: string | null = null;

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
    // Pre-fill certification fields from application data (FN-233)
    this.prefillCertificationFields();
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

  /** Pre-fill certification fields from the employment application data (FN-233) */
  private prefillCertificationFields(): void {
    const cert = this.employment.certificationFields || {};
    const emp = this.employment;
    if (!cert.fullName && (emp.firstName || emp.lastName)) {
      cert.fullName = [emp.firstName, emp.middleName, emp.lastName].filter(Boolean).join(' ');
    }
    if (!cert.dateOfBirth && emp.dateOfBirth) {
      cert.dateOfBirth = emp.dateOfBirth;
    }
    if (!cert.signatureDate) {
      cert.signatureDate = new Date().toISOString().slice(0, 10);
    }
    this.employment.certificationFields = cert;
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
    this.expandedConsent = null;
  }

  isConsentSigned(consentKey: string): boolean {
    return this.signedConsents.has(consentKey);
  }

  toggleConsent(consentKey: string): void {
    this.expandedConsent = this.expandedConsent === consentKey ? null : consentKey;
  }

  isConsentExpanded(consentKey: string): boolean {
    return this.expandedConsent === consentKey;
  }

  getConsentStatusLabel(config: ConsentKeyConfig): string {
    if (this.signedConsents.has(config.key)) return 'Completed';
    return 'Pending';
  }

  get completedConsentsCount(): number {
    return this.consentKeys.filter((c) => this.signedConsents.has(c.key)).length;
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

  // === SSN Masking ===
  onSsnInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').slice(0, 9);
    this.ssnRaw = digits;
    this.employment.ssn = digits;

    // Auto-format with dashes and restore cursor position
    const formatted = this.formatSsnWithDashes(digits);
    const cursorPos = input.selectionStart || 0;
    const prevLen = input.value.length;
    input.value = this.ssnMasked ? this.getMaskedSsn(digits) : formatted;
    const newLen = input.value.length;
    const adjustedPos = cursorPos + (newLen - prevLen);
    input.setSelectionRange(adjustedPos, adjustedPos);
  }

  toggleSsnVisibility(): void {
    this.ssnMasked = !this.ssnMasked;
  }

  getSsnDisplay(): string {
    if (!this.ssnRaw) return '';
    return this.ssnMasked
      ? this.getMaskedSsn(this.ssnRaw)
      : this.formatSsnWithDashes(this.ssnRaw);
  }

  private formatSsnWithDashes(digits: string): string {
    if (!digits) return '';
    if (digits.length <= 3) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  }

  private getMaskedSsn(digits: string): string {
    if (!digits) return '';
    if (digits.length <= 3) return '\u2022'.repeat(digits.length);
    if (digits.length <= 5) return `\u2022\u2022\u2022-${'\u2022'.repeat(digits.length - 3)}`;
    return `\u2022\u2022\u2022-\u2022\u2022-${digits.slice(5)}`;
  }

  // === Dynamic Address Logic ===
  recalcResidencyYears(): void {
    let total = parseFloat(this.employment.yearsAtAddress || '0') || 0;
    for (const addr of (this.employment.previousAddresses || [])) {
      total += parseFloat(addr.yearsAtAddress || '0') || 0;
    }
    this.totalResidencyYears = total;
    this.needMoreAddresses = total < 3 && total > 0;
    if (this.needMoreAddresses && (!this.employment.previousAddresses || this.employment.previousAddresses.length === 0)) {
      this.addPreviousAddress();
    }
  }

  addPreviousAddress(): void {
    if (!this.employment.previousAddresses) this.employment.previousAddresses = [];
    this.employment.previousAddresses.push({});
  }

  removePreviousAddress(i: number): void {
    this.employment.previousAddresses?.splice(i, 1);
    this.recalcResidencyYears();
  }

  // === Dynamic Employer Logic ===
  recalcEmployerYears(): void {
    let total = 0;
    const cur = this.employment.currentEmployer;
    if (cur?.fromDate) {
      const parts = cur.fromDate.split('/');
      if (parts.length === 2) {
        const start = new Date(parseInt(parts[1]), parseInt(parts[0]) - 1);
        total += (Date.now() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      }
    }
    for (const emp of (this.employment.previousEmployers || [])) {
      if (emp.fromDate && emp.toDate) {
        const fp = emp.fromDate.split('/');
        const tp = emp.toDate.split('/');
        if (fp.length === 2 && tp.length === 2) {
          const s = new Date(parseInt(fp[1]), parseInt(fp[0]) - 1);
          const e = new Date(parseInt(tp[1]), parseInt(tp[0]) - 1);
          total += (e.getTime() - s.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
        }
      }
    }
    this.totalEmployerYears = total;
    this.needMoreEmployers = total < 3 && total > 0;
    if (this.needMoreEmployers && (!this.employment.previousEmployers || this.employment.previousEmployers.length === 0)) {
      this.addPreviousEmployer();
    }
  }

  addPreviousEmployer(): void {
    if (!this.employment.previousEmployers) this.employment.previousEmployers = [];
    this.employment.previousEmployers.push({});
  }

  removePreviousEmployer(i: number): void {
    this.employment.previousEmployers?.splice(i, 1);
    this.recalcEmployerYears();
  }

  // === Accident Records ===
  onHasAccidentsChange(val: string): void {
    this.employment.hasAccidents = val;
    if (val === 'yes' && (!this.employment.accidents || this.employment.accidents.length === 0)) {
      this.addAccident();
    }
    if (val === 'no') this.employment.accidents = [];
  }

  addAccident(): void {
    if (!this.employment.accidents) this.employment.accidents = [];
    this.employment.accidents.push({});
  }

  removeAccident(i: number): void { this.employment.accidents?.splice(i, 1); }

  // === Traffic Violations ===
  onHasViolationsChange(val: string): void {
    this.employment.hasViolations = val;
    if (val === 'yes' && (!this.employment.violations || this.employment.violations.length === 0)) {
      this.addViolation();
    }
    if (val === 'no') this.employment.violations = [];
  }

  addViolation(): void {
    if (!this.employment.violations) this.employment.violations = [];
    this.employment.violations.push({});
  }

  removeViolation(i: number): void { this.employment.violations?.splice(i, 1); }

  // === License History ===
  addLicense(): void {
    if (!this.employment.licenses) this.employment.licenses = [];
    this.employment.licenses.push({});
  }

  removeLicense(i: number): void { this.employment.licenses?.splice(i, 1); }
}
