import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { OnboardingModalService } from '../../services/onboarding-modal.service';
import { OperatingEntityContextService } from '../../services/operating-entity-context.service';
import { AccessControlService } from '../../services/access-control.service';
import {
  DrugAlcoholTest,
  DrugTestType,
  SubstanceType,
  DrugTestResult,
  DRUG_TEST_TYPE_LABELS,
  SUBSTANCE_TYPE_LABELS,
  DRUG_TEST_RESULT_LABELS
} from '../../models/drug-alcohol.model';
import { InvestigationHistoryComponent } from './investigation-history/investigation-history.component';

@Component({
  selector: 'app-drivers',
  templateUrl: './drivers.component.html',
  styleUrls: ['./drivers.component.css']
})
export class DriversComponent implements OnInit, OnDestroy {
  drivers: any[] = [];
  loading = true;
  showAddForm = false;
  editingDriver: any = null;
  showDQFForm = false;
  selectedDriver: any = null;
  uploadingFile = false;
  
  newDriver: any = {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    cdlNumber: '',
    cdlState: '',
    cdlClass: 'A',
    endorsements: [],
    cdlExpiry: '',
    medicalCertExpiry: '',
    hireDate: '',
    address: '',
    dateOfBirth: '',
    clearinghouseStatus: 'eligible'
  };
  
  dqfForm: any = {
    applicationComplete: false,
    mvrComplete: false,
    roadTestComplete: false,
    medicalCertComplete: false,
    annualReviewComplete: false,
    clearinghouseConsentComplete: false,
    notes: ''
  };
  
  driverDocuments: any[] = [];
  uploadingDocuments: { [key: string]: boolean } = {};

  // Pre-Hire Documents (FN-237)
  prehireDocuments: any[] = [];
  prehireDocumentsLoading = false;

  /** Human-readable labels for pre-hire document types */
  prehireDocTypeLabels: Record<string, string> = {
    employment_application_signed: 'Employment Application Document',
    consent_fcra_disclosure_signed: 'FCRA Disclosure',
    consent_fcra_authorization_signed: 'FCRA Authorization',
    consent_release_of_information_signed: 'Release of Info / DQ & Safety',
    consent_drug_alcohol_release_signed: 'Release of Info / Drug & Alcohol',
    consent_mvr_disclosure_signed: 'MVR Disclosure',
    consent_mvr_authorization_signed: 'MVR Authorization',
    consent_mvr_release_of_liability_signed: 'MVR Release of Liability'
  };

  saving = false;
  canManageDrivers = false;
  canAccessDqf = false;

  driverFilters: {
    name: string;
    cdlNumber: string;
    cdlExpiry: string;
    medicalExpiry: string;
    dqfMin: string;
    clearinghouseStatus: string;
    status: string;
  } = {
    name: '',
    cdlNumber: '',
    cdlExpiry: '',
    medicalExpiry: '',
    dqfMin: '',
    clearinghouseStatus: '',
    status: ''
  };

  presetFilter: '' | 'med-certs' | 'clearinghouse' | 'dqf-low' = '';
  highlightDriverId: string | null = null;
  activeOperatingEntityName = '';

  driverSafetyLoading = false;
  driverSafetyError = '';
  driverSafetySummary: {
    totalIncidents: number;
    openIncidents: number;
    preventableIncidents: number;
    dotRecordableIncidents: number;
    totalEstimatedLoss: number;
    lastIncidentDate: string | null;
    recentIncidents: any[];
  } = {
    totalIncidents: 0,
    openIncidents: 0,
    preventableIncidents: 0,
    dotRecordableIncidents: 0,
    totalEstimatedLoss: 0,
    lastIncidentDate: null,
    recentIncidents: []
  };

  // FN-240: Label overrides for DQF requirement display names
  dqfLabelOverrides: Record<string, string> = {
    employment_application_submitted: 'Employment Application Document'
  };

  // FN-240: Auto-pull state
  autoPullingEmpApp = false;
  autoPullEmpAppError = '';

  // FN-264: MVR report upload and extracted data
  mvrData: {
    license_status?: string;
    license_class?: string;
    violations_count?: number;
    accidents_count?: number;
    points_total?: number;
    report_date?: string;
    document_id?: string;
  } | null = null;
  mvrDataLoading = false;
  mvrUploadProgress = false;

  // Dynamic DQF requirements
  dqfRequirements: any[] = [];
  dqfRequirementsLoading = false;
  dqfCompleteness = 0;
  updateingRequirementKey: string | null = null;

  // Categorized DQF requirements
  dqfCategories: {
    key: string;
    label: string;
    requirements: any[];
    expanded: boolean;
  }[] = [];

  // FN-258: Active DQF tab for tab navigation
  activeDqfTab = 'pre_hire';

  // Clearance status
  clearanceStatus: { cleared: boolean; requirements?: any[]; missingItems: string[] } = {
    cleared: false,
    missingItems: []
  };
  clearanceLoading = false;

  // ── Drug & Alcohol Test Management (FN-214) ──
  drugAlcoholTests: DrugAlcoholTest[] = [];
  drugAlcoholTestsLoading = false;
  showDrugTestForm = false;
  editingDrugTest: DrugAlcoholTest | null = null;
  savingDrugTest = false;
  drugTestTypeFilter: DrugTestType | '' = '';
  drugTestClearinghouseFilter: 'pending' | '' = '';

  drugTestTypeLabels = DRUG_TEST_TYPE_LABELS;
  substanceTypeLabels = SUBSTANCE_TYPE_LABELS;
  drugTestResultLabels = DRUG_TEST_RESULT_LABELS;

  drugTestTypes: DrugTestType[] = [
    'pre_employment', 'random', 'reasonable_suspicion',
    'post_accident', 'return_to_duty', 'follow_up'
  ];
  substanceTypes: SubstanceType[] = ['drug', 'alcohol', 'both'];
  drugTestResults: DrugTestResult[] = ['negative', 'positive', 'refused', 'cancelled', 'invalid'];

  newDrugTest: DrugAlcoholTest = this.getEmptyDrugTest('');

  // Audit trail
  auditTrailOpen: { [key: string]: boolean } = {};
  auditTrailData: { [key: string]: any[] } = {};
  auditTrailLoading: { [key: string]: boolean } = {};

  @ViewChild('investigationHistory') investigationHistory?: InvestigationHistoryComponent;

  private destroy$ = new Subject<void>();
  private lastOperatingEntityId: string | null | undefined = undefined;

  constructor(
    private apiService: ApiService,
    private onboardingModal: OnboardingModalService,
    private route: ActivatedRoute,
    private operatingEntityContext: OperatingEntityContextService,
    private access: AccessControlService
  ) { }

  ngOnInit(): void {
    const adminSafetyRoles = ['super_admin', 'admin', 'company_admin', 'safety_manager', 'safety'];
    this.canManageDrivers = this.access.hasAnyRole(adminSafetyRoles) || this.access.hasAnyPermission(['drivers.edit', 'drivers.manage']);
    this.canAccessDqf = this.access.hasAnyRole(adminSafetyRoles) || this.access.hasAnyPermission(['dqf.view', 'dqf.edit', 'dqf.manage']);

    this.bindOperatingEntityContext();
    this.route.queryParams.subscribe(params => {
      const filter = params['filter'];
      const highlight = params['highlight'];
      this.highlightDriverId = highlight || null;
      if (filter === 'med-certs') {
        this.presetFilter = 'med-certs';
        this.driverFilters = { ...this.driverFilters, clearinghouseStatus: '', dqfMin: '' };
      } else if (filter === 'clearinghouse') {
        this.presetFilter = 'clearinghouse';
        this.driverFilters = { ...this.driverFilters, clearinghouseStatus: 'query-pending', dqfMin: '' };
      } else if (filter === 'dqf-low') {
        this.presetFilter = 'dqf-low';
        this.driverFilters = { ...this.driverFilters, clearinghouseStatus: '', dqfMin: '75' };
      } else {
        this.presetFilter = '';
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private bindOperatingEntityContext(): void {
    this.operatingEntityContext.context$()
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => {
        if (!state.isLoaded) return;

        this.activeOperatingEntityName = state.selectedOperatingEntity?.name || '';
        const nextId = state.selectedOperatingEntityId || null;

        if (this.lastOperatingEntityId === undefined) {
          this.lastOperatingEntityId = nextId;
          this.loadDrivers();
          return;
        }

        if (this.lastOperatingEntityId !== nextId) {
          this.lastOperatingEntityId = nextId;
          this.drivers = [];
          this.selectedDriver = null;
          this.editingDriver = null;
          this.showDQFForm = false;
          this.showAddForm = false;
          this.loadDrivers();
        }
      });
  }

  get filteredDrivers(): any[] {
    const f = this.driverFilters;
    let list = (this.drivers || []).filter((driver) => {
      if (f.name) {
        const name = `${driver.firstName || ''} ${driver.lastName || ''} ${driver.email || ''}`.toLowerCase();
        if (!name.includes(f.name.toLowerCase())) return false;
      }
      if (f.cdlNumber) {
        const cdl = (driver.cdlNumber || '').toString().toLowerCase();
        if (!cdl.includes(f.cdlNumber.toLowerCase())) return false;
      }
      if (f.cdlExpiry) {
        const val = driver.cdlExpiry ? new Date(driver.cdlExpiry).toISOString().slice(0, 10) : '';
        if (!val.includes(f.cdlExpiry)) return false;
      }
      if (f.medicalExpiry) {
        const val = driver.medicalCertExpiry ? new Date(driver.medicalCertExpiry).toISOString().slice(0, 10) : '';
        if (!val.includes(f.medicalExpiry)) return false;
      }
      if (f.dqfMin) {
        const min = parseInt(f.dqfMin, 10);
        if (!Number.isNaN(min) && (driver.dqfCompleteness ?? 0) < min) return false;
      }
      if (f.clearinghouseStatus) {
        if ((driver.clearinghouseStatus || '').toString() !== f.clearinghouseStatus) return false;
      }
      if (f.status) {
        if ((driver.status || '').toString() !== f.status) return false;
      }
      return true;
    });

    if (this.presetFilter === 'med-certs') {
      const today = new Date();
      const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      list = list.filter(d => {
        const cdl = d.cdlExpiry ? new Date(d.cdlExpiry) : null;
        const med = d.medicalCertExpiry ? new Date(d.medicalCertExpiry) : null;
        return (cdl && cdl <= thirtyDaysFromNow) || (med && med <= thirtyDaysFromNow);
      });
    }

    return list;
  }

  private normalizeDate(value: any): string {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  private parseDate(value: any): Date | null {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Derived values for date pickers (new driver)
  get newDobValue(): Date | null {
    return this.parseDate(this.newDriver.dateOfBirth);
  }

  get newHireDateValue(): Date | null {
    return this.parseDate(this.newDriver.hireDate);
  }

  get newCdlExpiryValue(): Date | null {
    return this.parseDate(this.newDriver.cdlExpiry);
  }

  get newMedExpiryValue(): Date | null {
    return this.parseDate(this.newDriver.medicalCertExpiry);
  }

  // Derived values for date pickers (edit driver)
  get editCdlExpiryValue(): Date | null {
    return this.editingDriver ? this.parseDate(this.editingDriver.cdlExpiry) : null;
  }

  get editMedExpiryValue(): Date | null {
    return this.editingDriver ? this.parseDate(this.editingDriver.medicalCertExpiry) : null;
  }

  // Date picker handlers for new driver form
  onNewDobChange(date: Date | null): void {
    this.newDriver.dateOfBirth = this.normalizeDate(date);
  }

  onNewHireDateChange(date: Date | null): void {
    this.newDriver.hireDate = this.normalizeDate(date);
  }

  onNewCdlExpiryChange(date: Date | null): void {
    this.newDriver.cdlExpiry = this.normalizeDate(date);
  }

  onNewMedExpiryChange(date: Date | null): void {
    this.newDriver.medicalCertExpiry = this.normalizeDate(date);
  }

  // Date picker handlers for edit driver form
  onEditCdlExpiryChange(date: Date | null): void {
    if (!this.editingDriver) return;
    this.editingDriver.cdlExpiry = this.normalizeDate(date);
  }

  onEditMedExpiryChange(date: Date | null): void {
    if (!this.editingDriver) return;
    this.editingDriver.medicalCertExpiry = this.normalizeDate(date);
  }

  toggleAddForm(): void {
    this.showAddForm = !this.showAddForm;
    if (!this.showAddForm) {
      this.resetForm();
    }
  }

  resetForm(): void {
    this.newDriver = {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      cdlNumber: '',
      cdlState: '',
      cdlClass: 'A',
      endorsements: [],
      cdlExpiry: '',
      medicalCertExpiry: '',
      hireDate: '',
      address: '',
      dateOfBirth: '',
      clearinghouseStatus: 'eligible'
    };
  }

  addDriver(): void {
    if (!this.canManageDrivers) return;

    if (!this.validateDriver()) {
      alert('Please fill in all required fields');
      return;
    }

    this.saving = true;
    this.apiService.createDriver(this.newDriver).subscribe({
      next: (driver) => {
        this.drivers.unshift(driver);
        this.showAddForm = false;
        this.resetForm();
        this.saving = false;
        alert('Driver added successfully!');
      },
      error: (error) => {
        console.error('Error adding driver:', error);
        alert('Failed to add driver. Please try again.');
        this.saving = false;
      }
    });
  }

  loadDrivers(): void {
    const load$ = this.canAccessDqf
      ? this.apiService.getDqfDrivers()
      : this.apiService.getDispatchDrivers();

    load$.subscribe({
      next: (data) => {
        this.drivers = data;
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading drivers:', error);
        this.loading = false;
      }
    });
  }

  getStatusBadge(status: string): string {
    return status === 'active' ? 'badge-success' : 'badge-danger';
  }

  getComplianceBadge(completeness: number): string {
    if (completeness >= 90) return 'badge-success';
    if (completeness >= 75) return 'badge-warning';
    return 'badge-danger';
  }

  isExpiringSoon(dateStr: string): boolean {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return false;
    const thirtyDaysFromNow = new Date(Date.now() + 30*24*60*60*1000);
    return date <= thirtyDaysFromNow;
  }

  editDriver(driver: any): void {
    if (!this.canManageDrivers) return;

    this.editingDriver = {
      ...driver,
      cdlExpiry: this.normalizeDate(driver.cdlExpiry),
      medicalCertExpiry: this.normalizeDate(driver.medicalCertExpiry),
      hireDate: this.normalizeDate(driver.hireDate),
      dateOfBirth: this.normalizeDate(driver.dateOfBirth)
    };
    this.showAddForm = false;
    this.showDQFForm = false;
  }

  cancelEdit(): void {
    this.editingDriver = null;
  }

  saveEdit(): void {
    if (!this.canManageDrivers) return;

    if (!this.validateDriver(this.editingDriver)) {
      alert('Please fill in all required fields');
      return;
    }

    // Check if driver should be set to inactive based on expiry dates and DQF
    const today = new Date();
    const cdlExpiry = this.editingDriver.cdlExpiry ? new Date(this.editingDriver.cdlExpiry) : null;
    const medicalExpiry = this.editingDriver.medicalCertExpiry ? new Date(this.editingDriver.medicalCertExpiry) : null;
    const dqfComplete = this.editingDriver.dqfCompleteness === 100;

    let statusMessage = '';
    if (cdlExpiry && cdlExpiry < today) {
      this.editingDriver.status = 'inactive';
      statusMessage = 'Status set to INACTIVE: CDL expired. ';
    } else if (medicalExpiry && medicalExpiry < today) {
      this.editingDriver.status = 'inactive';
      statusMessage = 'Status set to INACTIVE: Medical certificate expired. ';
    } else if (!dqfComplete) {
      this.editingDriver.status = 'inactive';
      statusMessage = 'Status set to INACTIVE: DQF must be 100% complete. ';
    }

    this.saving = true;
    this.apiService.updateDriver(this.editingDriver.id, this.editingDriver).pipe(
      finalize(() => (this.saving = false))
    ).subscribe({
      next: (updatedDriver) => {
        const index = this.drivers.findIndex(d => d.id === updatedDriver.id);
        if (index !== -1) {
          this.drivers[index] = updatedDriver;
        }
        this.editingDriver = null;
        alert(statusMessage + 'Driver updated successfully!');
      },
      error: (error) => {
        console.error('Error updating driver:', error);
        const msg = error?.name === 'TimeoutError' || error?.message?.includes('timeout')
          ? 'Request timed out. The server may be slow—please try again.'
          : 'Failed to update driver. Please try again.';
        alert(msg);
      }
    });
  }

  validateDriver(driver: any = this.newDriver): boolean {
    return !!(driver.firstName && 
             driver.lastName && 
             driver.email && 
             driver.cdlNumber && 
             driver.cdlState && 
             driver.cdlClass);
  }

  openDQFForm(driver: any): void {
    if (!this.canAccessDqf) return;

    this.selectedDriver = driver;
    this.showDQFForm = true;
    this.showAddForm = false;
    this.editingDriver = null;
    this.activeDqfTab = 'pre_hire';
    this.loadDQFStatus(driver);
    this.loadDriverDocuments(driver.id);
    this.loadDriverSafetySummary(driver.id);
    this.loadDrugAlcoholTests(driver.id);
    this.loadPrehireDocuments(driver.id);
    this.loadMvrData(driver.id);
  }

  /** Load pre-hire documents for a driver (FN-237) */
  loadPrehireDocuments(driverId: string): void {
    this.prehireDocumentsLoading = true;
    this.prehireDocuments = [];
    this.apiService.getDriverPrehireDocuments(driverId).subscribe({
      next: (docs) => {
        this.prehireDocuments = docs || [];
        this.prehireDocumentsLoading = false;
      },
      error: () => {
        this.prehireDocuments = [];
        this.prehireDocumentsLoading = false;
      }
    });
  }

  /** Get human-readable label for a pre-hire document type */
  getPrehireDocLabel(docType: string): string {
    return this.prehireDocTypeLabels[docType] || docType;
  }

  /** Get the download URL for a pre-hire document */
  getPrehireDocDownloadUrl(doc: any): string {
    return `${this.apiService.getBaseUrl()}/dqf/documents/${doc.id}/download`;
  }

  loadDriverDocuments(driverId: string): void {
    // Legacy / uploaded DQF docs
    this.apiService.getDriverDocuments(driverId).subscribe({
      next: (docs) => {
        this.driverDocuments = docs || [];

        // Also include generated onboarding PDFs from driver_documents
        this.apiService.getDqfDriver(driverId).subscribe({
          next: (dqfResp) => {
            const generated = (dqfResp?.dqf?.documents || [])
              .map((doc: any) => {
                let mappedType: string | null = null;
                if (doc.doc_type === 'employment_application_pdf') {
                  mappedType = 'application';
                } else if (doc.doc_type === 'mvr_authorization_pdf') {
                  mappedType = 'mvr';
                }
                if (!mappedType) return null;
                return {
                  id: doc.id,
                  document_type: mappedType,
                  file_name: doc.file_name,
                  mime_type: doc.mime_type,
                  size_bytes: doc.size_bytes,
                  created_at: doc.created_at,
                  // mark as generated so we know which download route to use
                  source: 'generated',
                  doc_type: doc.doc_type
                };
              })
              .filter((x: any) => !!x);

            this.driverDocuments = this.driverDocuments.concat(generated);
          },
          error: (err) => {
            // eslint-disable-next-line no-console
            console.error('Error loading generated driver documents', err);
          }
        });
      },
      error: (error) => {
        console.error('Error loading documents:', error);
      }
    });
  }

  getDocumentsByType(documentType: string): any[] {
    return this.driverDocuments.filter(doc => doc.document_type === documentType);
  }

  downloadDoc(doc: any): void {
    if (!doc || !doc.id) return;

    const isGenerated =
      doc.doc_type === 'employment_application_pdf' ||
      doc.doc_type === 'mvr_authorization_pdf' ||
      doc.source === 'generated';

    const download$ = isGenerated
      ? this.apiService.downloadDriverGeneratedDocumentBlob(doc.id)
      : this.apiService.downloadDQFDocumentBlob(doc.id);

    download$.subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.file_name || 'document.pdf';
        a.click();
        window.URL.revokeObjectURL(url);
      },
      error: (error) => {
        // eslint-disable-next-line no-console
        console.error('Error downloading document:', error);
        alert('Failed to download document. Please try again.');
      }
    });
  }

  onDQFFileSelected(event: any, documentType: string): void {
    if (!this.canManageDrivers) return;

    const file = event.target.files[0];
    if (!file || !this.selectedDriver) return;

    this.uploadingDocuments[documentType] = true;

    this.apiService.uploadDQFDocument(this.selectedDriver.id, documentType, file).subscribe({
      next: (response) => {
        this.driverDocuments.push(response.document);
        this.uploadingDocuments[documentType] = false;
        alert(`${documentType} uploaded successfully!`);
        event.target.value = ''; // Reset file input
      },
      error: (error) => {
        console.error('Error uploading document:', error);
        alert('Failed to upload document. Please try again.');
        this.uploadingDocuments[documentType] = false;
        event.target.value = '';
      }
    });
  }

  deleteDocument(documentId: string, documentType: string): void {
    if (!this.canManageDrivers) return;

    if (!confirm('Are you sure you want to delete this document?')) return;

    this.apiService.deleteDQFDocument(documentId).subscribe({
      next: () => {
        this.driverDocuments = this.driverDocuments.filter(doc => doc.id !== documentId);
        alert('Document deleted successfully!');
      },
      error: (error) => {
        console.error('Error deleting document:', error);
        alert('Failed to delete document. Please try again.');
      }
    });
  }

  getDownloadUrl(doc: any): string {
    // Fallback: keep URL-based download if ever needed elsewhere
    if (doc && (doc.doc_type === 'employment_application_pdf' || doc.doc_type === 'mvr_authorization_pdf' || doc.source === 'generated')) {
      return `${this.apiService.getBaseUrl()}/dqf/documents/${doc.id}/download`;
    }
    return `${this.apiService.getBaseUrl()}/dqf-documents/download/${doc.id}`;
  }

  closeDQFForm(): void {
    this.showDQFForm = false;
    this.selectedDriver = null;
    this.driverSafetyError = '';
    this.driverSafetySummary = {
      totalIncidents: 0,
      openIncidents: 0,
      preventableIncidents: 0,
      dotRecordableIncidents: 0,
      totalEstimatedLoss: 0,
      lastIncidentDate: null,
      recentIncidents: []
    };
    // Reset drug/alcohol test state
    this.drugAlcoholTests = [];
    this.showDrugTestForm = false;
    this.editingDrugTest = null;
    this.drugTestTypeFilter = '';
    this.drugTestClearinghouseFilter = '';
  }

  loadDriverSafetySummary(driverId: string): void {
    if (!driverId) return;
    this.driverSafetyLoading = true;
    this.driverSafetyError = '';

    this.apiService.getSafetyIncidents({ driver_id: driverId, page: 1, pageSize: 100 }).subscribe({
      next: (resp: any) => {
        const incidents = Array.isArray(resp?.data) ? resp.data : [];
        const sorted = [...incidents].sort((a: any, b: any) => {
          const aTime = new Date(a?.incident_date || 0).getTime();
          const bTime = new Date(b?.incident_date || 0).getTime();
          return bTime - aTime;
        });

        this.driverSafetySummary = {
          totalIncidents: incidents.length,
          openIncidents: incidents.filter((i: any) => i?.status && i.status !== 'closed').length,
          preventableIncidents: incidents.filter((i: any) => i?.preventability === 'preventable').length,
          dotRecordableIncidents: incidents.filter((i: any) => !!i?.dot_recordable).length,
          totalEstimatedLoss: incidents.reduce((sum: number, i: any) => sum + Number(i?.estimated_loss_amount || 0), 0),
          lastIncidentDate: sorted[0]?.incident_date || null,
          recentIncidents: sorted.slice(0, 3)
        };
        this.driverSafetyLoading = false;
      },
      error: () => {
        this.driverSafetyError = 'Unable to load accident history summary.';
        this.driverSafetyLoading = false;
      }
    });
  }

  safetyStatusClass(status: string): string {
    return status === 'closed' ? 'safety-status-closed' : 'safety-status-open';
  }

  loadDQFStatus(driver: any): void {
    // Load dynamic DQF requirements from server
    this.dqfRequirementsLoading = true;
    this.auditTrailOpen = {};
    this.auditTrailData = {};
    this.auditTrailLoading = {};
    this.apiService.getDqfDriver(driver.id).subscribe({
      next: (response) => {
        const dqfData = response?.dqf || {};
        this.dqfRequirements = dqfData.requirements || [];
        this.dqfCompleteness = dqfData.completeness || 0;
        this.dqfRequirementsLoading = false;

        // Build categorized view
        this.buildDqfCategories();

        // Keep legacy form for backward compat
        this.dqfForm = {
          applicationComplete: !!driver.email && !!driver.phone,
          mvrComplete: !!driver.cdlNumber,
          roadTestComplete: !!driver.hireDate,
          medicalCertComplete: !!driver.medicalCertExpiry && new Date(driver.medicalCertExpiry) > new Date(),
          annualReviewComplete: false,
          clearinghouseConsentComplete: driver.clearinghouseStatus === 'eligible',
          notes: ''
        };
      },
      error: (err) => {
        console.error('Error loading DQF requirements', err);
        this.dqfRequirementsLoading = false;
        // Fallback to legacy calculation
        this.dqfRequirements = [];
        this.dqfCompleteness = driver.dqfCompleteness || 0;
        this.buildDqfCategories();
      }
    });

    // Load clearance status
    this.loadClearanceStatus(driver.id);
  }

  loadClearanceStatus(driverId: string): void {
    this.clearanceLoading = true;
    this.apiService.getDriverClearanceStatus(driverId).subscribe({
      next: (status) => {
        this.clearanceStatus = {
          cleared: status?.cleared ?? false,
          requirements: status?.requirements,
          missingItems: status?.missingItems ?? (status as any)?.missing ?? []
        };
        this.clearanceLoading = false;
      },
      error: () => {
        // Fallback: derive clearance from pre-hire requirements
        this.clearanceStatus = this.deriveClearanceFromRequirements();
        this.clearanceLoading = false;
      }
    });
  }

  /** Derive clearance status locally when API is unavailable */
  private deriveClearanceFromRequirements(): { cleared: boolean; missingItems: string[] } {
    const preHireKeys = this.getCategoryKeyMap()['pre_hire'] || [];
    const missing: string[] = [];
    for (const req of this.dqfRequirements) {
      if (preHireKeys.includes(req.key) && req.status !== 'complete') {
        missing.push(req.label || req.key);
      }
    }
    return { cleared: missing.length === 0, missingItems: missing };
  }

  /** Map of category key -> array of requirement keys that belong to it */
  private getCategoryKeyMap(): Record<string, string[]> {
    return {
      pre_hire: [
        'employment_application',
        'employment_application_submitted',
        'pre_employment_drug_test_completed',
        'clearinghouse_full_query_consent',
        'medical_examiners_certificate',
        'fcra_authorization',
        'fcra_disclosure_signed',
        'fcra_authorization_signed',
        'release_of_info_dq_safety_signed',
        'drug_alcohol_release_signed',
        'consent_forms_signed',
        'mvr_disclosure_signed',
        'mvr_authorization_signed',
        'mvr_release_of_liability_signed',
        // FN-261: Moved from Ongoing to Pre-Hire Documents
        'driver_license_front_on_file',
        'driver_license_back_on_file',
        'medical_card_front_on_file',
        // FN-269: Removed medical_card_back_on_file (medical card is usually one page)
        'psp_authorization_document',
        'mvr_report_document'
      ],
      pre_hire_checklist: [
        'employment_application_completed',
        'cdl_on_file',
        'clearinghouse_consent_sent',
        'clearinghouse_consent_received',
        'clearinghouse_result_received',
        'employment_verification_submitted',
        'mvr_authorization_signed',
        'pre_employment_drug_test_submitted',
        'pre_employment_drug_test_result_received',
        'psp_consent',
        // FN-261: Moved from Other to Pre-Hire Checklist
        'pre_employment_drug_test_scheduled',
        // FN-264: MVR data received checklist item
        'mvr_data_received',
        // FN-269: Medical card received (auto-completes on Medical Examiner's Certificate upload)
        'medical_card_received',
        // FN-269: Consent received tracking items
        'fcra_disclosure_received',
        'fcra_authorization_received',
        'release_of_info_dq_safety_received',
        'drug_alcohol_release_received',
        'mvr_disclosure_received',
        'mvr_release_of_liability_received'
      ],
      within_30_days: [
        'mvr_all_states',
        'previous_employer_investigation',
        'driver_investigation_history',
        // FN-261: New requirement
        'employment_verification_received'
      ],
      annual: [
        'annual_mvr_inquiry',
        'annual_driving_record_review',
        // FN-261: Moved from Other to Annual Requirements
        'annual_clearinghouse_limited_query',
        'medical_cert_renewal'
      ],
      // FN-261: "Other Documents" now only contains green_card_on_file
      other: [
        'green_card_on_file'
      ]
    };
  }

  /** CFR references for known requirement keys */
  getCfrReference(key: string): string {
    const refs: Record<string, string> = {
      employment_application: '49 CFR 391.21',
      pre_employment_drug_test_completed: '49 CFR 382.301',
      clearinghouse_full_query_consent: '49 CFR 382.701',
      road_test_certificate: '49 CFR 391.31',
      medical_examiners_certificate: '49 CFR 391.43',
      nrcme_verification: '49 CFR 391.23(m)',
      fcra_authorization: 'FCRA 15 USC 1681',
      consent_forms_signed: '49 CFR 391.23',
      release_of_info_signed: '49 CFR 391.23(d)',
      mvr_all_states: '49 CFR 391.23(a)',
      previous_employer_investigation: '49 CFR 391.23(d)',
      driver_investigation_history: '49 CFR 391.53',
      driver_license_front_on_file: '49 CFR 391.51(b)(2)',
      driver_license_back_on_file: '49 CFR 391.51(b)(2)',
      medical_card_front_on_file: '49 CFR 391.51(b)(7)',
      // FN-269: Removed medical_card_back_on_file
      green_card_on_file: '8 CFR 274a.2',
      eldt_certificate: '49 CFR 380.609',
      medical_variance_spe: '49 CFR 391.49',
      annual_mvr_inquiry: '49 CFR 391.25(a)',
      annual_driving_record_review: '49 CFR 391.25(c)',
      annual_clearinghouse_limited_query: '49 CFR 382.701(b)',
      medical_cert_renewal: '49 CFR 391.45',
      employment_application_completed: '49 CFR 391.21',
      cdl_on_file: '49 CFR 391.51(b)(2)',
      clearinghouse_consent_sent: '49 CFR 382.701',
      clearinghouse_consent_received: '49 CFR 382.701',
      clearinghouse_result_received: '49 CFR 382.701',
      employment_verification_submitted: '49 CFR 391.23(d)',
      mvr_authorization_signed: '49 CFR 391.23(a)',
      pre_employment_drug_test_submitted: '49 CFR 382.301',
      pre_employment_drug_test_result_received: '49 CFR 382.301',
      psp_consent: '49 CFR 391.23(i)',
      psp_authorization_document: 'FMCSA PSP / 49 C.F.R. §383.5',
      mvr_report_document: '49 CFR 391.23(a)(1)',
      // FN-236: Pre-hire consent form CFR references
      fcra_disclosure_signed: '15 U.S.C. \u00A7 1681',
      fcra_authorization_signed: '15 U.S.C. \u00A7 1681b',
      release_of_info_dq_safety_signed: '49 CFR \u00A7391.23',
      drug_alcohol_release_signed: '49 CFR Part 40',
      mvr_disclosure_signed: '15 U.S.C. \u00A71681b(b)(2)',
      mvr_release_of_liability_signed: '15 U.S.C. \u00A71681b(b)(2)',
      employment_application_submitted: '49 CFR 391.21',
      // FN-261: New requirement CFR references
      pre_employment_drug_test_scheduled: '49 CFR 382.301',
      employment_verification_received: '49 CFR 391.23(d)',
      // FN-264: MVR data received
      mvr_data_received: '49 CFR 391.23(a)(1)',
      // FN-269: Medical card received
      medical_card_received: '49 CFR 391.43',
      // FN-269: Consent received tracking CFR references
      fcra_disclosure_received: '15 U.S.C. \u00A7 1681',
      fcra_authorization_received: '15 U.S.C. \u00A7 1681b',
      release_of_info_dq_safety_received: '49 CFR \u00A7391.23',
      drug_alcohol_release_received: '49 CFR Part 40',
      mvr_disclosure_received: '15 U.S.C. \u00A71681b(b)(2)',
      mvr_release_of_liability_received: '15 U.S.C. \u00A71681b(b)(2)'
    };
    return refs[key] || '';
  }

  /** Build categories from flat requirements array */
  buildDqfCategories(): void {
    const categoryMap = this.getCategoryKeyMap();
    // FN-261: Removed "Ongoing Documents" category; added "Other Documents"
    const categoryDefs: { key: string; label: string }[] = [
      { key: 'pre_hire', label: 'Pre-Hire Documents (Before Driving)' },
      { key: 'pre_hire_checklist', label: 'Pre-Hire Checklist' },
      { key: 'within_30_days', label: 'Within 30 Days of Hire' },
      { key: 'annual', label: 'Annual Requirements' },
      { key: 'other', label: 'Other Documents' }
    ];

    const assignedKeys = new Set<string>();
    this.dqfCategories = categoryDefs.map(cat => {
      const keys = categoryMap[cat.key] || [];
      const reqs = keys
        .map(k => this.dqfRequirements.find(r => r.key === k))
        .filter(r => !!r);
      reqs.forEach(r => assignedKeys.add(r.key));

      const hasIncomplete = reqs.some(r => r.status !== 'complete');
      return {
        key: cat.key,
        label: cat.label,
        requirements: reqs,
        expanded: hasIncomplete
      };
    }).filter(cat => cat.requirements.length > 0); // FN-261: Skip empty categories

    // Any remaining requirements not in a named category go into "Other Documents"
    const uncategorized = this.dqfRequirements.filter(r => !assignedKeys.has(r.key));
    if (uncategorized.length > 0) {
      const existingOther = this.dqfCategories.find(c => c.key === 'other');
      if (existingOther) {
        existingOther.requirements.push(...uncategorized);
        existingOther.expanded = existingOther.requirements.some(r => r.status !== 'complete');
      } else {
        this.dqfCategories.push({
          key: 'other',
          label: 'Other Documents',
          requirements: uncategorized,
          expanded: uncategorized.some(r => r.status !== 'complete')
        });
      }
    }

    // FN-261: Apply warning overrides and recalculate DQF completeness
    this.applyDqfWarningOverrides();
    this.recalculateDqfCompleteness();
  }

  /**
   * FN-261: Apply warning status overrides for time-sensitive categories.
   * - "Within 30 Days" items: show WARNING if still within 30 days of hire.
   * - "Annual Requirements": show WARNING if 10-12 months since hire, ERROR if 12+ months.
   */
  private applyDqfWarningOverrides(): void {
    if (!this.selectedDriver?.hireDate) return;

    const hireDate = new Date(this.selectedDriver.hireDate);
    if (isNaN(hireDate.getTime())) return;

    const now = new Date();
    const thirtyDaysAfterHire = new Date(hireDate);
    thirtyDaysAfterHire.setDate(thirtyDaysAfterHire.getDate() + 30);

    // Within 30 Days: if still within the 30-day window, mark incomplete items as "warning"
    const within30Cat = this.dqfCategories.find(c => c.key === 'within_30_days');
    if (within30Cat && thirtyDaysAfterHire > now) {
      for (const req of within30Cat.requirements) {
        if (req.status !== 'complete') {
          req._dqfOverrideStatus = 'warning';
        }
      }
    }

    // Annual Requirements: determine months since hire
    const monthsSinceHire = (now.getFullYear() - hireDate.getFullYear()) * 12
      + (now.getMonth() - hireDate.getMonth());

    const annualCat = this.dqfCategories.find(c => c.key === 'annual');
    if (annualCat) {
      for (const req of annualCat.requirements) {
        if (req.status === 'complete') continue;
        if (monthsSinceHire < 10) {
          // Not yet due: exclude from calc, no special badge needed
          req._dqfExclude = true;
        } else if (monthsSinceHire >= 10 && monthsSinceHire < 12) {
          // Due soon: include in calc, show warning badge
          req._dqfOverrideStatus = 'warning';
        }
        // 12+ months: stays as-is (missing/error), included in calc
      }
    }
  }

  /**
   * FN-261: Recalculate DQF completeness excluding:
   * - "Other Documents" category entirely
   * - Items flagged with _dqfExclude (e.g., annual items not yet due)
   * - "Within 30 Days" items still in warning window
   */
  private recalculateDqfCompleteness(): void {
    let total = 0;
    let done = 0;

    for (const cat of this.dqfCategories) {
      // FN-261: Exclude "Other Documents" from completeness calc
      if (cat.key === 'other') continue;

      for (const req of cat.requirements) {
        // FN-261: Exclude items flagged for exclusion
        if (req._dqfExclude) continue;
        // FN-261: Exclude "Within 30 Days" items that are in warning period
        if (cat.key === 'within_30_days' && req._dqfOverrideStatus === 'warning') continue;

        const weight = req.weight || 1;
        total += weight;
        if (req.status === 'complete') {
          done += weight;
        }
      }
    }

    this.dqfCompleteness = total > 0 ? Math.round((done / total) * 100) : 0;
  }

  getCategoryCompletedCount(category: { requirements: any[] }): number {
    return category.requirements.filter((r: Record<string, unknown>) =>
      r['status'] === 'complete' && !r['_dqfExclude']
    ).length;
  }

  getCategoryCompletionPct(category: { requirements: any[] }): number {
    // FN-261: Exclude items flagged for exclusion from the percentage
    const countable = category.requirements.filter((r: Record<string, unknown>) => !r['_dqfExclude']);
    if (countable.length === 0) return 100;
    const done = countable.filter((r: Record<string, unknown>) => r['status'] === 'complete').length;
    return Math.round((done / countable.length) * 100);
  }

  toggleCategory(category: { expanded: boolean }): void {
    category.expanded = !category.expanded;
  }

  /** FN-258: Switch active DQF tab */
  setActiveDqfTab(tabKey: string): void {
    this.activeDqfTab = tabKey;
    if (tabKey === 'pre_hire' && this.selectedDriver?.id) {
      this.loadPrehireDocuments(this.selectedDriver.id);
    }
  }

  /** FN-258: Return "done/total" string for tab badge */
  getCategoryCompletionCount(cat: { requirements: any[] }): string {
    // FN-261: Exclude items flagged for exclusion from counts
    const countable = cat.requirements?.filter((r: Record<string, unknown>) => !r['_dqfExclude']) || [];
    const total = countable.length;
    const done = countable.filter((r: Record<string, unknown>) => r['status'] === 'complete').length;
    return `${done}/${total}`;
  }

  getStatusChipClass(status: string): string {
    switch (status) {
      case 'complete': return 'dqf-chip-complete';
      case 'received':
      case 'sent': return 'dqf-chip-in-progress';
      case 'review_required': return 'dqf-chip-review';
      case 'warning': return 'dqf-chip-warning'; // FN-261
      case 'n/a': return 'dqf-chip-na';
      default: return 'dqf-chip-missing';
    }
  }

  /** FN-261: Resolve display status considering override */
  getEffectiveStatus(req: Record<string, unknown>): string {
    return (req['_dqfOverrideStatus'] as string) || (req['status'] as string) || 'missing';
  }

  getStatusChipLabel(status: string): string {
    switch (status) {
      case 'complete': return 'Complete';
      case 'received': return 'In Progress';
      case 'sent': return 'In Progress';
      case 'review_required': return 'Review Required';
      case 'warning': return 'Due Soon'; // FN-261
      case 'n/a': return 'N/A';
      default: return 'Missing';
    }
  }

  toggleAuditTrail(req: any): void {
    const key = req.key;
    if (this.auditTrailOpen[key]) {
      this.auditTrailOpen[key] = false;
      return;
    }
    this.auditTrailOpen[key] = true;
    if (this.auditTrailData[key]) return; // already loaded

    this.auditTrailLoading[key] = true;
    if (!this.selectedDriver) { this.auditTrailLoading[key] = false; return; }
    this.apiService.getDqfRequirementChanges(this.selectedDriver.id, key).subscribe({
      next: (changes) => {
        this.auditTrailData[key] = Array.isArray(changes) ? changes : (changes?.changes || []);
        this.auditTrailLoading[key] = false;
      },
      error: () => {
        this.auditTrailData[key] = [];
        this.auditTrailLoading[key] = false;
      }
    });
  }

  printDqfReport(): void {
    window.print();
  }

  updateRequirementStatus(requirement: any, newStatus: string): void {
    if (!this.canManageDrivers) return;

    if (!this.selectedDriver) return;

    this.updateingRequirementKey = requirement.key;
    this.apiService.updateDqfRequirementStatus(
      this.selectedDriver.id,
      requirement.key,
      {
        status: newStatus as any,
        note: `Updated via drivers form`
      }
    ).subscribe({
      next: (response) => {
        // Update local requirement
        const idx = this.dqfRequirements.findIndex(r => r.key === requirement.key);
        if (idx >= 0) {
          this.dqfRequirements[idx].status = newStatus;
        }
        this.updateingRequirementKey = null;
        // FN-261: Rebuild categories (which also recalculates completeness with exclusions)
        this.buildDqfCategories();
        // Re-derive clearance status
        this.clearanceStatus = this.deriveClearanceFromRequirements();
      },
      error: (err) => {
        console.error('Error updating requirement', err);
        alert('Failed to update requirement status');
        this.updateingRequirementKey = null;
      }
    });
  }

  // FN-223: Keys that require a date when marking done (inline date picker)
  readonly dateCaptureDqfKeys = [
    'clearinghouse_consent_sent',
    'clearinghouse_consent_received',
    'clearinghouse_result_received'
  ];
  dqfDateInputs: Record<string, string> = {};

  requiresDateCapture(key: string): boolean {
    return this.dateCaptureDqfKeys.includes(key);
  }

  updateRequirementStatusWithDate(requirement: any, newStatus: string): void {
    if (!this.canManageDrivers || !this.selectedDriver) return;
    const dateVal = this.dqfDateInputs[requirement.key];
    this.updateingRequirementKey = requirement.key;
    this.apiService.updateDqfRequirementStatus(
      this.selectedDriver.id,
      requirement.key,
      {
        status: newStatus as any,
        completionDate: dateVal || undefined,
        note: dateVal ? `Completed on ${dateVal}` : 'Updated via drivers form'
      }
    ).subscribe({
      next: () => {
        const idx = this.dqfRequirements.findIndex(r => r.key === requirement.key);
        if (idx >= 0) {
          this.dqfRequirements[idx].status = newStatus;
          this.dqfRequirements[idx].completion_date = dateVal || null;
        }
        this.updateingRequirementKey = null;
        this.dqfDateInputs[requirement.key] = '';
        // FN-261: Rebuild categories (which also recalculates completeness with exclusions)
        this.buildDqfCategories();
        this.clearanceStatus = this.deriveClearanceFromRequirements();
      },
      error: () => {
        alert('Failed to update requirement status');
        this.updateingRequirementKey = null;
      }
    });
  }

  /** Returns true for requirements that need an uploaded document as evidence */
  isDqfDocumentReq(key: string): boolean {
    const docKeys = [
      'driver_license_front_on_file', 'driver_license_back_on_file',
      'medical_card_front_on_file',
      // FN-269: Removed medical_card_back_on_file
      'green_card_on_file', 'pre_employment_drug_test_completed',
      'release_of_info_signed'
    ];
    return docKeys.includes(key);
  }

  /** FN-240: Get display label for a DQF requirement, applying frontend overrides */
  getDqfReqLabel(req: { key: string; label: string }): string {
    return this.dqfLabelOverrides[req.key] || req.label;
  }

  /** FN-240: Auto-pull employment application document from onboarding packet */
  autoPullEmploymentApp(): void {
    if (!this.selectedDriver) return;
    this.autoPullingEmpApp = true;
    this.autoPullEmpAppError = '';
    this.apiService.autoPullEmploymentApp(this.selectedDriver.id).subscribe({
      next: () => {
        this.autoPullingEmpApp = false;
        // Reload DQF status and pre-hire documents to reflect the completed requirement
        this.loadDQFStatus(this.selectedDriver);
        this.loadPrehireDocuments(this.selectedDriver.id);
      },
      error: (err: { error?: { message?: string } }) => {
        this.autoPullingEmpApp = false;
        this.autoPullEmpAppError = err?.error?.message || 'Failed to pull employment application. Please try again.';
        console.error('Failed to pull employment application:', err);
      }
    });
  }

  /** FN-264: Upload an MVR report PDF and store extracted data */
  uploadMvrReport(driverId: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) return;

    this.mvrUploadProgress = true;
    this.apiService.uploadMvrReport(driverId, file).subscribe({
      next: (response: Record<string, unknown>) => {
        this.mvrUploadProgress = false;
        this.mvrData = (response?.['mvr_data'] as typeof this.mvrData) || null;
        input.value = '';
        // Reload DQF status to reflect completed requirement
        if (this.selectedDriver) {
          this.loadDQFStatus(this.selectedDriver);
        }
      },
      error: (err: { error?: { message?: string } }) => {
        this.mvrUploadProgress = false;
        input.value = '';
        console.error('MVR upload failed:', err);
        alert(err?.error?.message || 'Failed to upload MVR report. Please try again.');
      }
    });
  }

  /** FN-264: Load previously extracted MVR data for a driver */
  loadMvrData(driverId: string): void {
    this.mvrDataLoading = true;
    this.mvrData = null;
    this.apiService.getMvrData(driverId).subscribe({
      next: (data: unknown) => {
        this.mvrData = (data as typeof this.mvrData) || null;
        this.mvrDataLoading = false;
      },
      error: () => {
        this.mvrData = null;
        this.mvrDataLoading = false;
      }
    });
  }

  onDQFFileSelectedForKey(event: any, requirementKey: string): void {
    if (!this.canManageDrivers) return;

    const file = event.target.files[0];
    if (!file || !this.selectedDriver) return;

    const docTypeMap: Record<string, string> = {
      driver_license_front_on_file: 'driver_license_front',
      driver_license_back_on_file: 'driver_license_back',
      medical_card_front_on_file: 'medical_card_front',
      // FN-269: Removed medical_card_back_on_file
      green_card_on_file: 'green_card',
      pre_employment_drug_test_completed: 'drug_test_result',
      release_of_info_signed: 'release_of_info',
      employment_application_submitted: 'employment_application'
    };

    const docType = docTypeMap[requirementKey] || requirementKey;
    this.uploadingDocuments[requirementKey] = true;

    this.apiService.uploadDQFDocument(this.selectedDriver.id, docType, file).subscribe({
      next: (response: any) => {
        this.uploadingDocuments[requirementKey] = false;
        event.target.value = '';
        // Auto-mark requirement complete with evidence
        const docId = response?.document?.id;
        if (!this.selectedDriver) return;
        this.apiService.updateDqfRequirementStatus(this.selectedDriver.id, requirementKey, {
          status: 'complete',
          evidenceDocumentId: docId,
          note: `Document uploaded: ${file.name}`
        }).subscribe({
          next: () => {
            const idx = this.dqfRequirements.findIndex(r => r.key === requirementKey);
            if (idx >= 0) {
              this.dqfRequirements[idx].status = 'complete';
              this.dqfRequirements[idx].evidence_document_id = docId;
            }
          },
          error: () => {}
        });
      },
      error: (error: any) => {
        console.error('Error uploading document:', error);
        alert('Failed to upload document. Please try again.');
        this.uploadingDocuments[requirementKey] = false;
        event.target.value = '';
      }
    });
  }

  downloadEvidenceDoc(documentId: string): void {
    this.apiService.downloadDriverGeneratedDocumentBlob(documentId).subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'evidence.pdf';
        a.click();
        window.URL.revokeObjectURL(url);
      },
      error: () => {
        alert('Failed to download evidence document');
      }
    });
  }

  saveDQFForm(): void {
    if (!this.canManageDrivers) return;

    // Count how many checkboxes are checked (excluding notes which is a string)
    const checkboxes = [
      this.dqfForm.applicationComplete,
      this.dqfForm.mvrComplete,
      this.dqfForm.roadTestComplete,
      this.dqfForm.medicalCertComplete,
      this.dqfForm.annualReviewComplete,
      this.dqfForm.clearinghouseConsentComplete
    ];
    
    const completedItems = checkboxes.filter(v => v === true).length;
    const totalItems = checkboxes.length;
    const dqfCompleteness = Math.round((completedItems / totalItems) * 100);

    // Set clearinghouse status based on consent checkbox
    const clearinghouseStatus = this.dqfForm.clearinghouseConsentComplete ? 'eligible' : 'query-pending';

    // Check if driver should be set to inactive based on DQF and expiry dates
    const today = new Date();
    const cdlExpiry = this.selectedDriver.cdlExpiry ? new Date(this.selectedDriver.cdlExpiry) : null;
    const medicalExpiry = this.selectedDriver.medicalCertExpiry ? new Date(this.selectedDriver.medicalCertExpiry) : null;
    
    let status = this.selectedDriver.status;
    let statusMessage = '';
    
    if (dqfCompleteness !== 100) {
      status = 'inactive';
      statusMessage = 'Status set to INACTIVE: DQF must be 100% complete. ';
    } else if (cdlExpiry && cdlExpiry < today) {
      status = 'inactive';
      statusMessage = 'Status set to INACTIVE: CDL expired. ';
    } else if (medicalExpiry && medicalExpiry < today) {
      status = 'inactive';
      statusMessage = 'Status set to INACTIVE: Medical certificate expired. ';
    } else if (dqfCompleteness === 100 && (!cdlExpiry || cdlExpiry >= today) && (!medicalExpiry || medicalExpiry >= today)) {
      status = 'active';
      statusMessage = 'Status set to ACTIVE: All requirements met. ';
    }

    this.saving = true;
    this.apiService.updateDriver(this.selectedDriver.id, { 
      dqfCompleteness: dqfCompleteness,
      clearinghouseStatus: clearinghouseStatus,
      status: status
    }).subscribe({
      next: (updatedDriver) => {
        const index = this.drivers.findIndex(d => d.id === updatedDriver.id);
        if (index !== -1) {
          this.drivers[index] = updatedDriver;
        }
        this.closeDQFForm();
        this.saving = false;
        alert(`${statusMessage}DQF updated! Completeness: ${dqfCompleteness}% (${completedItems}/${totalItems} items complete)\nClearinghouse Status: ${clearinghouseStatus}`);
      },
      error: (error) => {
        console.error('Error updating DQF:', error);
        alert('Failed to update DQF. Please try again.');
        this.saving = false;
      }
    });
  }

  onFileSelected(event: any, driver: any): void {
    if (!this.canManageDrivers) return;

    const file = event.target.files[0];
    if (!file) return;

    // For now, we'll just simulate upload
    // In production, you'd upload to a file server or cloud storage
    this.uploadingFile = true;
    
    setTimeout(() => {
      // Update clearinghouse status to 'consented'
      this.apiService.updateDriver(driver.id, { clearinghouse_status: 'consented' }).subscribe({
        next: (updatedDriver) => {
          const index = this.drivers.findIndex(d => d.id === updatedDriver.id);
          if (index !== -1) {
            this.drivers[index] = updatedDriver;
          }
          this.uploadingFile = false;
          alert(`Clearinghouse consent uploaded for ${driver.firstName} ${driver.lastName}`);
        },
        error: (error) => {
          console.error('Error uploading file:', error);
          alert('Failed to upload file. Please try again.');
          this.uploadingFile = false;
        }
      });
    }, 1000);
  }

  // ========== Onboarding packet (modal rendered at app root via OnboardingModalService) ==========
  openOnboardingModal(driver: any): void {
    this.showAddForm = false;
    this.editingDriver = null;
    this.showDQFForm = false;
    this.selectedDriver = null;
    this.onboardingModal.open(driver);
  }

  // ========== Drug & Alcohol Test Management (FN-214) ==========

  getEmptyDrugTest(driverId: string): DrugAlcoholTest {
    return {
      driver_id: driverId,
      test_type: 'pre_employment',
      substance_type: 'drug',
      panel_details: {
        marijuana: true,
        cocaine: true,
        opiates: true,
        amphetamines: true,
        pcp: true
      },
      collection_site: '',
      collection_date: '',
      lab_name: '',
      mro_name: '',
      mro_verified: false,
      ccf_number: '',
      result: undefined,
      result_received_date: '',
      clearinghouse_reported: 'not_reported',
      notes: ''
    };
  }

  loadDrugAlcoholTests(driverId: string): void {
    this.drugAlcoholTestsLoading = true;
    this.apiService.getDrugAlcoholTests(driverId).subscribe({
      next: (tests) => {
        this.drugAlcoholTests = tests || [];
        this.drugAlcoholTestsLoading = false;
      },
      error: () => {
        this.drugAlcoholTests = [];
        this.drugAlcoholTestsLoading = false;
      }
    });
  }

  get filteredDrugTests(): DrugAlcoholTest[] {
    let list = this.drugAlcoholTests;
    if (this.drugTestTypeFilter) {
      list = list.filter(t => t.test_type === this.drugTestTypeFilter);
    }
    if (this.drugTestClearinghouseFilter === 'pending') {
      list = list.filter(t => t.clearinghouse_reported !== 'reported');
    }
    return list;
  }

  openAddDrugTest(): void {
    if (!this.selectedDriver) return;
    this.newDrugTest = this.getEmptyDrugTest(this.selectedDriver.id);
    this.editingDrugTest = null;
    this.drugTestResultFile = null;
    this.drugTestResultFileName = '';
    this.drugTestResultError = '';
    this.showDrugTestForm = true;
  }

  // FN-225: Drug test result attachment
  drugTestResultFile: File | null = null;
  drugTestResultFileName: string = '';
  drugTestResultError: string = '';
  uploadingDrugTestDoc: boolean = false;

  onDrugTestResultFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.drugTestResultFile = input.files[0];
      this.drugTestResultFileName = input.files[0].name;
      this.drugTestResultError = '';
    }
  }

  openEditDrugTest(test: DrugAlcoholTest): void {
    this.drugTestResultFile = null;
    this.drugTestResultFileName = test.result_document_id ? 'Previously uploaded' : '';
    this.drugTestResultError = '';
    this.editingDrugTest = { ...test };
    if (!this.editingDrugTest.panel_details) {
      this.editingDrugTest.panel_details = {
        marijuana: true, cocaine: true, opiates: true,
        amphetamines: true, pcp: true
      };
    }
    this.showDrugTestForm = true;
  }

  cancelDrugTestForm(): void {
    this.showDrugTestForm = false;
    this.editingDrugTest = null;
  }

  get activeDrugTestForm(): DrugAlcoholTest {
    return this.editingDrugTest || this.newDrugTest;
  }

  showPanelDetails(): boolean {
    const form = this.activeDrugTestForm;
    return form.substance_type === 'drug' || form.substance_type === 'both';
  }

  saveDrugTest(): void {
    if (!this.canManageDrivers || !this.selectedDriver) return;

    const form = this.activeDrugTestForm;
    if (!form.test_type || !form.substance_type) {
      alert('Please fill in all required fields (Test Type, Substance Type).');
      return;
    }

    // Validate: if a result is selected, require collection_date, test_date, and collection_site
    if (form.result) {
      const missing: string[] = [];
      if (!form.collection_date) missing.push('Collection Date');
      if (!form.collection_site) missing.push('Collection Site');
      if (missing.length > 0) {
        alert(`When a result is selected, the following fields are required: ${missing.join(', ')}`);
        return;
      }
    }

    // FN-225: Validate attachment required when result is selected
    const hasExistingDoc = this.editingDrugTest?.result_document_id;
    if (form.result && !this.drugTestResultFile && !hasExistingDoc) {
      this.drugTestResultError = 'Please upload the drug test result document before saving.';
      return;
    }
    this.drugTestResultError = '';

    this.savingDrugTest = true;
    const driverId = this.selectedDriver.id;

    if (this.editingDrugTest && this.editingDrugTest.id) {
      this.apiService.updateDrugAlcoholTest(this.editingDrugTest.id, form).pipe(
        finalize(() => (this.savingDrugTest = false))
      ).subscribe({
        next: (updated) => {
          const idx = this.drugAlcoholTests.findIndex(t => t.id === updated.id);
          if (idx >= 0) {
            this.drugAlcoholTests[idx] = updated;
          }
          // FN-225: Upload result doc if a new file was selected
          if (this.drugTestResultFile && updated.id) {
            this.uploadResultDocument(driverId, updated.id);
          }
          this.showDrugTestForm = false;
          this.editingDrugTest = null;
          this.drugTestResultFile = null;
          this.drugTestResultFileName = '';
        },
        error: () => {
          alert('Failed to update drug/alcohol test. Please try again.');
        }
      });
    } else {
      this.apiService.createDrugAlcoholTest(driverId, form).pipe(
        finalize(() => (this.savingDrugTest = false))
      ).subscribe({
        next: (created) => {
          this.drugAlcoholTests.unshift(created);
          // FN-225: Upload result doc after creating the test
          if (this.drugTestResultFile && created.id) {
            this.uploadResultDocument(driverId, created.id);
          }
          this.showDrugTestForm = false;
          this.drugTestResultFile = null;
          this.drugTestResultFileName = '';
        },
        error: () => {
          alert('Failed to create drug/alcohol test. Please try again.');
        }
      });
    }
  }

  /** FN-225: Upload the result document after test create/update */
  private uploadResultDocument(driverId: string, testId: string): void {
    if (!this.drugTestResultFile) return;
    this.apiService.uploadDrugTestResultDocument(driverId, testId, this.drugTestResultFile).subscribe({
      next: (doc) => {
        // Update the test in the list with the new document ID
        const idx = this.drugAlcoholTests.findIndex(t => t.id === testId);
        if (idx >= 0) {
          this.drugAlcoholTests[idx].result_document_id = doc.id;
        }
        // Reload DQF to reflect auto-completed requirements
        if (this.selectedDriver) {
          this.apiService.getDqfDriver(this.selectedDriver.id).subscribe({
            next: (resp) => {
              const dqf = resp?.dqf || {};
              this.dqfRequirements = dqf.requirements || [];
              this.dqfCompleteness = dqf.completeness || 0;
              this.buildDqfCategories();
              this.clearanceStatus = this.deriveClearanceFromRequirements();
            }
          });
        }
      },
      error: (err) => {
        console.error('Failed to upload drug test result document:', err);
        alert('Test saved but failed to upload result document. Please try again via Edit.');
      }
    });
  }

  markClearinghouseReported(test: DrugAlcoholTest): void {
    if (!test.id) return;
    this.apiService.markTestClearinghouseReported(test.id).subscribe({
      next: () => {
        const idx = this.drugAlcoholTests.findIndex(t => t.id === test.id);
        if (idx >= 0) {
          this.drugAlcoholTests[idx] = {
            ...this.drugAlcoholTests[idx],
            clearinghouse_reported: 'reported'
          };
        }
      },
      error: () => {
        alert('Failed to mark test as reported. Please try again.');
      }
    });
  }

  getTestTypeBadgeClass(testType: DrugTestType): string {
    switch (testType) {
      case 'pre_employment': return 'da-badge-blue';
      case 'random': return 'da-badge-cyan';
      case 'reasonable_suspicion': return 'da-badge-amber';
      case 'post_accident': return 'da-badge-red';
      case 'return_to_duty': return 'da-badge-purple';
      case 'follow_up': return 'da-badge-slate';
      default: return 'da-badge-slate';
    }
  }

  getResultBadgeClass(result: DrugTestResult | undefined): string {
    switch (result) {
      case 'negative': return 'badge-success';
      case 'positive': return 'badge-danger';
      case 'refused': return 'badge-danger';
      case 'cancelled': return 'badge-warning';
      case 'invalid': return 'badge-warning';
      default: return 'badge-warning';
    }
  }

  onDrugTestCollectionDateChange(date: string): void {
    this.activeDrugTestForm.collection_date = date;
  }

  // ========== Employer Investigation History ==========
  onInvestigationHistoryUpdated(): void {
    if (this.investigationHistory) {
      this.investigationHistory.loadHistory();
    }
  }
}
