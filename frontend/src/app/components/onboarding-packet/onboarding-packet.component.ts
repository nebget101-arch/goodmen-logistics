import { Component, ElementRef, HostListener, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Subject, Subscription, of } from 'rxjs';
import { debounceTime, switchMap, catchError, filter } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { ConsentService } from '../../services/consent.service';
import { SeoService } from '../../services/seo.service';
import { SEO_PUBLIC } from '../../services/seo-public-presets';
import { environment } from '../../../environments/environment';
import { EmployerHistoryData } from './employer-history-tiered/employer-history-tiered.component';
import { DisqualificationData } from './disqualification-history/disqualification-history.component';

interface AddressSuggestion {
  street: string;
  city: string;
  state: string;
  zip: string;
}

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

export interface DocumentTypeConfig {
  key: string;
  label: string;
  description: string;
  icon: string;
  required: boolean;
}

export interface UploadedDocument {
  id: string;
  document_type: string;
  file_name: string;
  uploaded_at: string;
}

export type PacketStep =
  | 'employment_application'
  | 'consent_forms'
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
export class OnboardingPacketComponent implements OnInit, OnDestroy {
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
    { key: 'fcra_disclosure', label: 'FCRA Disclosure', icon: 'policy', requiresSignature: true, captureFields: ['fullName'] },
    { key: 'fcra_authorization', label: 'FCRA Authorization', icon: 'verified_user', requiresSignature: true, captureFields: ['fullName', 'dateOfBirth', 'ssnLast4', 'driversLicenseNumber', 'stateOfIssue'] },
    { key: 'release_of_information', label: 'Release of Information Authorization (DQ & Safety)', icon: 'share', requiresSignature: true, captureFields: ['fullName', 'dateOfBirth', 'driversLicenseNumber', 'stateOfIssue'] },
    { key: 'drug_alcohol_release', label: 'Release of Information Authorization (Drug & Alcohol)', icon: 'local_pharmacy', requiresSignature: true, captureFields: ['fullName', 'dateOfBirth', 'driversLicenseNumber', 'stateOfIssue'] },
    { key: 'mvr_disclosure', label: 'MVR Disclosure', icon: 'description', requiresSignature: true, captureFields: ['fullName'] },
    { key: 'mvr_authorization', label: 'MVR Authorization', icon: 'how_to_reg', requiresSignature: true, captureFields: ['fullName', 'dateOfBirth', 'driversLicenseNumber', 'stateOfIssue'] },
    { key: 'mvr_release_of_liability', label: 'MVR Release of Liability', icon: 'gavel', requiresSignature: true, captureFields: [] },
    { key: 'psp_consent', label: 'PSP Disclosure and Authorization', icon: 'security', requiresSignature: true, captureFields: ['fullName', 'dateOfBirth', 'driversLicenseNumber', 'stateOfIssue'] }
  ];

  signedConsents: Set<string> = new Set();
  expandedConsent: string | null = null;

  steps: { key: PacketStep; label: string; icon: string; sectionKey?: string }[] = [
    { key: 'employment_application', label: 'Employment Application', icon: 'description', sectionKey: 'employment_application' },
    { key: 'consent_forms', label: 'Consent Forms', icon: 'verified_user', sectionKey: 'consent_forms' },
    { key: 'document_uploads', label: 'Document Uploads', icon: 'upload_file', sectionKey: 'document_uploads' },
    { key: 'review_submit', label: 'Review & Submit', icon: 'fact_check' }
  ];

  // Document upload state (FN-250)
  documentTypes: DocumentTypeConfig[] = [
    { key: 'cdl_front', label: 'CDL - Front', description: 'Front of your Commercial Driver\'s License', icon: 'badge', required: true },
    { key: 'cdl_back', label: 'CDL - Back', description: 'Back of your Commercial Driver\'s License', icon: 'badge', required: true },
    { key: 'medical_certificate', label: 'Medical Examiner\'s Certificate', description: 'DOT Medical Card (Form MCSA-5876)', icon: 'medical_information', required: true },
    { key: 'social_security_card', label: 'Social Security Card', description: 'Copy of your Social Security Card', icon: 'credit_card', required: false },
    { key: 'other_certification', label: 'Other Certification', description: 'Any additional certifications or endorsements', icon: 'workspace_premium', required: false }
  ];
  uploadedDocuments: Map<string, UploadedDocument> = new Map();
  uploadingDocType: string | null = null;
  deletingDocType: string | null = null;
  uploadError: string | null = null;

  // FN-269: File preview state — file is selected but not yet uploaded
  pendingFiles: Map<string, { file: File; previewUrl: string | null }> = new Map();

  // FN-534: Address autocomplete state
  addressSuggestions: { [key: string]: AddressSuggestion[] } = {};
  activeAutocompleteKey: string | null = null;
  private addressInput$ = new Subject<{ key: string; query: string }>();
  private autocompleteSub?: Subscription;

  get requiredDocsCount(): number {
    return this.documentTypes.filter(d => d.required).length;
  }

  get uploadedDocsCount(): number {
    return this.documentTypes.filter(d => d.required && this.uploadedDocuments.has(d.key)).length;
  }

  get requiredDocsComplete(): boolean {
    return this.documentTypes.filter(d => d.required).every(d => this.uploadedDocuments.has(d.key));
  }

  constructor(
    private route: ActivatedRoute,
    private apiService: ApiService,
    private consentService: ConsentService,
    private seo: SeoService,
    private http: HttpClient,
    private elRef: ElementRef
  ) {
    this.packetId = this.route.snapshot.paramMap.get('packetId');
    this.token = this.route.snapshot.queryParamMap.get('token');
  }

  ngOnInit(): void {
    const path = this.packetId ? `/onboard/${this.packetId}` : SEO_PUBLIC.driverOnboarding.path;
    this.seo.apply({ ...SEO_PUBLIC.driverOnboarding, path });
    this.loadPacket();

    // FN-534: Address autocomplete pipeline
    this.autocompleteSub = this.addressInput$.pipe(
      debounceTime(300),
      filter(({ query }) => query.length >= 3),
      switchMap(({ key, query }) =>
        this.http.get<{ success: boolean; data: AddressSuggestion[] }>(`${environment.apiUrl}/address/autocomplete`, { params: { q: query } }).pipe(
          catchError(() => of({ success: false, data: [] as AddressSuggestion[] }))
        ).pipe(
          switchMap(response => {
            const results = response.data || [];
            this.addressSuggestions = { ...this.addressSuggestions, [key]: results };
            this.activeAutocompleteKey = results.length > 0 ? key : null;
            return of(null);
          })
        )
      )
    ).subscribe();
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
        this.loadConsentStatuses();
        this.loadUploadedDocuments();
        this.prefillLicenseFromDriver();
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

  /** FN-252: Load signed consent statuses from API to rehydrate after page refresh */
  private loadConsentStatuses(): void {
    if (!this.packetId || !this.token) return;
    this.consentService.getConsentStatuses(this.packetId, this.token).subscribe({
      next: (res) => {
        for (const c of (res.consents || [])) {
          if (c.status === 'signed') {
            this.signedConsents.add(c.consent_key);
          }
        }
        // Trigger change detection by replacing the Set reference
        this.signedConsents = new Set(this.signedConsents);
      },
      error: () => {
        // Silently fail — consent statuses will show as pending
      }
    });
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
    this.uploadError = null;
    if (step === 'document_uploads') {
      this.loadUploadedDocuments();
    }
  }

  isSectionCompleted(sectionKey: string): boolean {
    if (sectionKey === 'consent_forms') {
      return this.consentKeys.every((c) => this.signedConsents.has(c.key));
    }
    if (sectionKey === 'document_uploads') {
      return this.requiredDocsComplete;
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
    if (sectionKey === 'document_uploads') {
      const uploaded = this.uploadedDocsCount;
      if (uploaded === this.requiredDocsCount) return 'Completed';
      if (uploaded > 0) return `${uploaded}/${this.requiredDocsCount} uploaded`;
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
      this.allConsentsSigned &&
      this.requiredDocsComplete
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

  // FN-524: tracks the auto-navigation timer so we can cancel it if needed
  private autoNavTimer: ReturnType<typeof setTimeout> | null = null;

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
          // FN-536: Store applicant data in session so consent forms can prefill capture fields
          this.storeSessionDataForConsentForms();
          // FN-524: Show success message then auto-navigate to consent forms after 2.5 s
          this.saveSuccess = 'Application submitted successfully! Taking you to consent forms…';
          const idx = this.sections.findIndex((s) => s.section_key === 'employment_application');
          if (idx >= 0) {
            this.sections = this.sections.map((s, i) =>
              i === idx ? { ...s, status: 'completed', completed_at: new Date().toISOString() } : s
            );
          } else {
            this.sections = [...this.sections, { section_key: 'employment_application', status: 'completed', completed_at: new Date().toISOString() }];
          }
          // FN-524: Auto-navigate to consent_forms after 2.5 s; fallback to showing success state
          this.autoNavTimer = setTimeout(() => {
            this.autoNavTimer = null;
            this.setStep('consent_forms');
          }, 2500);
        },
        error: (err) => {
          this.saving = false;
          this.errorMessage = err?.error?.message || 'Failed to save employment application.';
        }
      });
  }

  /** FN-536: Write applicant data to sessionStorage so consent-form can prefill capture fields */
  private storeSessionDataForConsentForms(): void {
    try {
      const emp = this.employment;
      const firstLicense = (emp.licenses && emp.licenses.length > 0) ? emp.licenses[0] : {};

      const sessionData = {
        fullName: [emp.firstName, emp.middleName, emp.lastName].filter(Boolean).join(' '),
        dateOfBirth: emp.dateOfBirth || '',
        ssnLast4: (this.ssnRaw || emp.ssn || '').slice(-4),
        driversLicenseNumber: firstLicense.licenseNumber || emp.licenseNumber || '',
        stateOfIssue: firstLicense.state || emp.licenseState || ''
      };

      sessionStorage.setItem('fn_onboarding_applicant', JSON.stringify(sessionData));
    } catch {
      // Silently ignore if sessionStorage is unavailable
    }
  }

  // FN-270: Track submission state
  packetSubmitted = false;
  packetSubmitting = false;
  submissionEmailSent = false;

  submitFinalPacket(): void {
    if (!this.packetId || !this.token || this.packetSubmitting) return;
    this.packetSubmitting = true;
    this.saveSuccess = null;
    this.errorMessage = null;

    this.apiService.finalizeOnboardingPacket(this.packetId, this.token).subscribe({
      next: (res) => {
        this.packetSubmitting = false;
        this.packetSubmitted = true;
        this.submissionEmailSent = !!res.emailSent;
        this.saveSuccess = 'Your onboarding packet has been submitted successfully!';
      },
      error: (err) => {
        this.packetSubmitting = false;
        this.errorMessage =
          err?.error?.message || 'Failed to submit onboarding packet. Please try again.';
      }
    });
  }

  // === Document Uploads (FN-250) ===
  loadUploadedDocuments(): void {
    if (!this.packetId || !this.token) return;
    this.apiService.getOnboardingDocuments(this.packetId, this.token).subscribe({
      next: (res) => {
        this.uploadedDocuments = new Map();
        for (const doc of (res.documents || [])) {
          this.uploadedDocuments.set(doc.document_type, doc);
        }
      },
      error: () => {
        // Silently fail — documents list may not exist yet
      }
    });
  }

  // FN-269: File selection now stages the file for preview instead of auto-uploading
  onDocumentFileSelected(event: Event, docType: string): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.packetId || !this.token) return;

    // Validate file size (10 MB max)
    if (file.size > 10 * 1024 * 1024) {
      this.uploadError = 'File is too large. Maximum size is 10 MB.';
      input.value = '';
      return;
    }

    this.uploadError = null;

    // Generate preview URL for images; null for PDFs
    let previewUrl: string | null = null;
    if (file.type.startsWith('image/')) {
      previewUrl = URL.createObjectURL(file);
    }

    // Stage the file for preview — do NOT upload yet
    this.pendingFiles = new Map(this.pendingFiles);
    this.pendingFiles.set(docType, { file, previewUrl });
    input.value = '';
  }

  // FN-269: Cancel a pending file selection
  cancelPendingFile(docType: string): void {
    const pending = this.pendingFiles.get(docType);
    if (pending?.previewUrl) {
      URL.revokeObjectURL(pending.previewUrl);
    }
    this.pendingFiles = new Map(this.pendingFiles);
    this.pendingFiles.delete(docType);
  }

  // FN-269: Upload the staged file when user clicks "Save Document"
  saveDocument(docType: string): void {
    const pending = this.pendingFiles.get(docType);
    if (!pending || !this.packetId || !this.token) return;

    this.uploadError = null;
    this.uploadingDocType = docType;
    this.apiService.uploadOnboardingDocument(this.packetId, docType, pending.file, this.token).subscribe({
      next: (res) => {
        this.uploadingDocType = null;
        // Clean up preview
        if (pending.previewUrl) {
          URL.revokeObjectURL(pending.previewUrl);
        }
        this.pendingFiles = new Map(this.pendingFiles);
        this.pendingFiles.delete(docType);
        // Reload documents list from server to get accurate state
        this.loadUploadedDocuments();
      },
      error: (err) => {
        this.uploadingDocType = null;
        this.uploadError = err?.error?.message || 'Failed to upload document. Please try again.';
      }
    });
  }

  // FN-269: Check if a file is a PDF (for showing PDF icon vs image preview)
  isPendingFilePdf(docType: string): boolean {
    const pending = this.pendingFiles.get(docType);
    return pending?.file?.type === 'application/pdf';
  }

  deleteUploadedDocument(docType: string, documentId: string): void {
    if (!this.packetId || !this.token) return;
    this.deletingDocType = docType;
    this.uploadError = null;
    this.apiService.deleteOnboardingDocument(this.packetId, documentId, this.token).subscribe({
      next: () => {
        this.deletingDocType = null;
        this.uploadedDocuments = new Map(this.uploadedDocuments);
        this.uploadedDocuments.delete(docType);
      },
      error: (err) => {
        this.deletingDocType = null;
        this.uploadError = err?.error?.message || 'Failed to delete document. Please try again.';
      }
    });
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

  // === FN-533: License Prefill (public endpoint) ===
  private prefillLicenseFromDriver(): void {
    if (!this.packetId || !this.token) return;

    const publicBase = environment.apiUrl.replace(/\/api\/?$/, '/public/onboarding');
    this.http.get<{ licenseNumber?: string; licenseState?: string }>(
      `${publicBase}/${this.packetId}/license`,
      { params: { token: this.token } }
    ).subscribe({
      next: (data) => {
        if (!data) return;
        const licenses = this.employment.licenses;
        if (!licenses || licenses.length === 0) return;
        const first = licenses[0];

        // Only patch if the field is currently empty (don't override user input)
        if (data.licenseNumber && !first.licenseNumber) {
          first.licenseNumber = data.licenseNumber;
        }
        if (data.licenseState && !first.state) {
          first.state = data.licenseState;
        }
      },
      error: () => {
        // Silently skip — section remains blank for manual entry
      }
    });
  }

  // === FN-534: Address Autocomplete ===
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (!this.elRef.nativeElement.contains(event.target)) {
      this.dismissAutocomplete();
    }
  }

  onAddressInput(key: string, event: Event): void {
    const query = (event.target as HTMLInputElement).value;
    if (query.length < 3) {
      this.addressSuggestions = { ...this.addressSuggestions, [key]: [] };
      if (this.activeAutocompleteKey === key) this.activeAutocompleteKey = null;
      return;
    }
    this.addressInput$.next({ key, query });
  }

  selectAddressSuggestion(
    key: string,
    suggestion: AddressSuggestion,
    target: { street: string; city: string; state: string; zip: string },
    fieldMap: { street: string; city: string; state: string; zip: string }
  ): void {
    (target as Record<string, string>)[fieldMap.street] = suggestion.street;
    (target as Record<string, string>)[fieldMap.city] = suggestion.city;
    (target as Record<string, string>)[fieldMap.state] = suggestion.state;
    (target as Record<string, string>)[fieldMap.zip] = suggestion.zip;
    this.addressSuggestions = { ...this.addressSuggestions, [key]: [] };
    this.activeAutocompleteKey = null;
  }

  selectCurrentAddressSuggestion(suggestion: AddressSuggestion): void {
    this.employment.addressStreet = suggestion.street;
    this.employment.addressCity = suggestion.city;
    this.employment.addressState = suggestion.state;
    this.employment.addressZip = suggestion.zip;
    this.addressSuggestions = { ...this.addressSuggestions, currentAddress: [] };
    this.activeAutocompleteKey = null;
  }

  selectPreviousAddressSuggestion(suggestion: AddressSuggestion, addr: PreviousAddress): void {
    addr.street = suggestion.street;
    addr.city = suggestion.city;
    addr.state = suggestion.state;
    addr.zip = suggestion.zip;
    this.addressSuggestions = {};
    this.activeAutocompleteKey = null;
  }

  selectEmployerAddressSuggestion(suggestion: AddressSuggestion, emp: EmployerEntry): void {
    emp.streetAddress = suggestion.street;
    emp.city = suggestion.city;
    emp.state = suggestion.state;
    emp.zipCode = suggestion.zip;
    this.addressSuggestions = {};
    this.activeAutocompleteKey = null;
  }

  onAddressKeydown(key: string, event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.addressSuggestions = { ...this.addressSuggestions, [key]: [] };
      this.activeAutocompleteKey = null;
    }
  }

  dismissAutocomplete(): void {
    this.activeAutocompleteKey = null;
    this.addressSuggestions = {};
  }

  // FN-524: Cancel auto-navigation timer on destroy to avoid memory leaks
  ngOnDestroy(): void {
    if (this.autoNavTimer !== null) {
      clearTimeout(this.autoNavTimer);
      this.autoNavTimer = null;
    }
    if (this.autocompleteSub) {
      this.autocompleteSub.unsubscribe();
    }
  }
}
