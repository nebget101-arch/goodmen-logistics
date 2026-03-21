import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { OnboardingModalService } from '../../services/onboarding-modal.service';
import { OperatingEntityContextService } from '../../services/operating-entity-context.service';
import { AccessControlService } from '../../services/access-control.service';
import { PERMISSIONS } from '../../models/access-control.model';

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
  
  saving = false;

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

  // Dynamic DQF requirements
  dqfRequirements: any[] = [];
  dqfRequirementsLoading = false;
  dqfCompleteness = 0;
  updateingRequirementKey: string | null = null;

  private destroy$ = new Subject<void>();
  private lastOperatingEntityId: string | null | undefined = undefined;

  constructor(
    private apiService: ApiService,
    private onboardingModal: OnboardingModalService,
    private route: ActivatedRoute,
    private operatingEntityContext: OperatingEntityContextService,
    private accessControl: AccessControlService
  ) { }

  get canManageDrivers(): boolean {
    return this.accessControl.hasPermission(PERMISSIONS.DRIVERS_EDIT);
  }

  get canAccessDqf(): boolean {
    return this.accessControl.hasAnyPermission([PERMISSIONS.DQF_VIEW, PERMISSIONS.DQF_EDIT]);
  }

  ngOnInit(): void {
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
    // Use the DQF view so we pull from the unified driver_licenses / driver_compliance tables
    this.apiService.getDqfDrivers().subscribe({
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
    const date = new Date(dateStr);
    const thirtyDaysFromNow = new Date(Date.now() + 30*24*60*60*1000);
    return date <= thirtyDaysFromNow;
  }

  editDriver(driver: any): void {
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
    this.selectedDriver = driver;
    this.showDQFForm = true;
    this.showAddForm = false;
    this.editingDriver = null;
    this.loadDQFStatus(driver);
    this.loadDriverDocuments(driver.id);
    this.loadDriverSafetySummary(driver.id);
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
    this.apiService.getDqfDriver(driver.id).subscribe({
      next: (response) => {
        const dqfData = response?.dqf || {};
        this.dqfRequirements = dqfData.requirements || [];
        this.dqfCompleteness = dqfData.completeness || 0;
        this.dqfRequirementsLoading = false;

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
      }
    });
  }

  updateRequirementStatus(requirement: any, newStatus: string): void {
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
        // Refresh completeness
        const total = this.dqfRequirements.reduce((sum, r) => sum + (r.weight || 1), 0);
        const done = this.dqfRequirements.filter(r => r.status === 'complete').reduce((sum, r) => sum + (r.weight || 1), 0);
        this.dqfCompleteness = total > 0 ? Math.round((done / total) * 100) : 0;
      },
      error: (err) => {
        console.error('Error updating requirement', err);
        alert('Failed to update requirement status');
        this.updateingRequirementKey = null;
      }
    });
  }

  /** Returns true for requirements that need an uploaded document as evidence */
  isDqfDocumentReq(key: string): boolean {
    const docKeys = [
      'driver_license_front_on_file', 'driver_license_back_on_file',
      'medical_card_front_on_file', 'medical_card_back_on_file',
      'green_card_on_file', 'pre_employment_drug_test_completed',
      'release_of_info_signed'
    ];
    return docKeys.includes(key);
  }

  onDQFFileSelectedForKey(event: any, requirementKey: string): void {
    const file = event.target.files[0];
    if (!file || !this.selectedDriver) return;

    const docTypeMap: Record<string, string> = {
      driver_license_front_on_file: 'driver_license_front',
      driver_license_back_on_file: 'driver_license_back',
      medical_card_front_on_file: 'medical_card_front',
      medical_card_back_on_file: 'medical_card_back',
      green_card_on_file: 'green_card',
      pre_employment_drug_test_completed: 'drug_test_result',
      release_of_info_signed: 'release_of_info'
    };

    const docType = docTypeMap[requirementKey] || requirementKey;
    this.uploadingDocuments[requirementKey] = true;

    this.apiService.uploadDQFDocument(this.selectedDriver.id, docType, file).subscribe({
      next: (response: any) => {
        this.uploadingDocuments[requirementKey] = false;
        event.target.value = '';
        // Auto-mark requirement complete with evidence
        const docId = response?.document?.id;
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
}
