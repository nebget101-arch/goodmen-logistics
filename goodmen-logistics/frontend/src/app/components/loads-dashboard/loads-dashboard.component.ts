import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import {
  LoadAttachmentType,
  LoadDetail,
  LoadListItem,
  LoadStatus,
  BillingStatus,
  LoadStop,
  LoadAiEndpointExtraction
} from '../../models/load-dashboard.model';
import { LoadsService } from '../../services/loads.service';
import { environment } from '../../../environments/environment';

type SortDir = 'asc' | 'desc';

@Component({
  selector: 'app-loads-dashboard',
  templateUrl: './loads-dashboard.component.html',
  styleUrls: ['./loads-dashboard.component.scss']
})
export class LoadsDashboardComponent implements OnInit, OnDestroy {
  loads: LoadListItem[] = [];
  loading = true;
  errorMessage = '';
  successMessage = '';

  showNewLoadMenu = false;
  showManualModal = false;
  showAutoModal = false;
  showDetailsModal = false;
  selectedLoad: LoadDetail | null = null;
  /** ID of load whose row actions menu is open (for click-outside close). */
  actionsOpenLoadId: string | null = null;
  /** True while POST /loads and uploads are in progress (modal submit). */
  creatingLoad = false;
  /** When set, manual modal is in edit mode for this load ID. */
  editingLoadId: string | null = null;
  /** Full detail for the load being edited (for attachments tabs). */
  editingLoadDetail: LoadDetail | null = null;

  /** Active tab in the attachments/extra section of the edit modal. */
  attachmentTab: 'services' | 'documents' | 'billing' | 'history' = 'documents';
  /** Upload attachment modal state. */
  showUploadModal = false;
  uploadAttachmentType: LoadAttachmentType = 'RATE_CONFIRMATION';
  uploadAttachmentNotes = '';
  uploadSelectedFiles: FileList | null = null;

  // Auto-create from PDF state
  autoPdfFile: File | null = null;
  autoExtracting = false;
  autoError = '';
  autoExtraction: LoadAiEndpointExtraction | null = null;

  drivers: { id: string; name: string }[] = [];
  trucks: { id: string; label: string }[] = [];
  trailers: { id: string; label: string }[] = [];
  brokers: { id: string; name: string }[] = [];
  brokerDropdownOpen = false;

  dispatcherName = '';
  dispatcherUserId: string | null = null;

  manualLoadForm: FormGroup;
  pendingAttachments: Array<{ file: File; type: LoadAttachmentType; notes?: string }> = [];
  attachmentType: LoadAttachmentType = 'RATE_CONFIRMATION';
  attachmentNotes = '';
  attachmentError = '';
  selectedAttachmentFiles: FileList | null = null;

  search$ = new Subject<string>();
  private destroy$ = new Subject<void>();

  page = 1;
  pageSize = 25;
  total = 0;

  filters: {
    status: string;
    billingStatus: string;
    driverId: string;
    q: string;
  } = {
    status: '',
    billingStatus: '',
    driverId: '',
    q: ''
  };

  sortBy: 'load_number' | 'pickup_date' | 'rate' | 'completed_date' = 'load_number';
  sortDir: SortDir = 'desc';

  // Summary totals for quick gross amount reporting on current page
  summaryTotals: {
    totalGross: number;
    byStatus: { [key: string]: number };
    byBilling: { [key: string]: number };
  } = {
    totalGross: 0,
    byStatus: {},
    byBilling: {}
  };

  // Header row filters (per-column filters under table headers)
  headerFilters: {
    date: string;
    broker: string;
    po: string;
    pickup: string;
    delivery: string;
    rate: string;
    notes: string;
    attachmentType: string;
  } = {
    date: '',
    broker: '',
    po: '',
    pickup: '',
    delivery: '',
    rate: '',
    notes: '',
    attachmentType: ''
  };

  get maxPage(): number {
    return Math.max(Math.ceil(this.total / this.pageSize), 1);
  }

  pickupCityEdited = false;
  pickupStateEdited = false;
  deliveryCityEdited = false;
  deliveryStateEdited = false;

  statusOptions: LoadStatus[] = ['NEW', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'];
  billingOptions: BillingStatus[] = ['PENDING', 'FUNDED', 'INVOICED', 'PAID'];

  constructor(private loadsService: LoadsService, private fb: FormBuilder) {
    this.manualLoadForm = this.fb.group({
      status: ['NEW', Validators.required],
      billingStatus: ['PENDING', Validators.required],
      dispatcher: [{ value: '', disabled: true }],
      pickupDate: ['', Validators.required],
      pickupCity: [''],
      pickupState: [''],
      pickupZip: [''],
      deliveryDate: ['', Validators.required],
      deliveryCity: [''],
      deliveryState: [''],
      deliveryZip: [''],
      driverId: [''],
      truckId: [''],
      trailerId: [''],
      brokerId: [''],
      brokerName: [''],
      poNumber: [''],
      rate: ['', [Validators.required, Validators.pattern(/^\d+(\.\d{1,2})?$/)]],
      notes: ['']
    });
  }

  ngOnInit(): void {
    this.loadDropdownData();
    this.loadLoads();

    this.search$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((value) => {
        this.filters.q = value;
        this.page = 1;
        this.loadLoads();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadDropdownData(): void {
    this.loadsService.getActiveDrivers().subscribe({
      next: (data) => {
        this.drivers = (data || []).map((driver) => ({
          id: driver.id,
          name: `${driver.firstName} ${driver.lastName}`.trim()
        }));
      },
      error: () => {
        this.drivers = [];
      }
    });

    this.loadsService.getEquipment('truck').subscribe({
      next: (res) => {
        this.trucks = (res?.data || []).map((vehicle) => ({
          id: vehicle.id,
          label: `${vehicle.unit_number} (${vehicle.make || ''} ${vehicle.model || ''})`.trim()
        }));
      },
      error: () => {
        this.trucks = [];
      }
    });

    this.loadsService.getEquipment('trailer').subscribe({
      next: (res) => {
        this.trailers = (res?.data || []).map((vehicle) => ({
          id: vehicle.id,
          label: `${vehicle.unit_number} (${vehicle.make || ''} ${vehicle.model || ''})`.trim()
        }));
      },
      error: () => {
        this.trailers = [];
      }
    });

    this.loadsService.getCurrentUser().subscribe({
      next: (res) => {
        const user = res?.data;
        const name = `${user?.first_name || ''} ${user?.last_name || ''}`.trim();
        this.dispatcherName = name || user?.username || '';
        this.dispatcherUserId = user?.id || null;
        this.manualLoadForm.patchValue({ dispatcher: this.dispatcherName });
      }
    });
  }

  loadBrokers(): void {
    this.loadsService.getBrokers().subscribe({
      next: (res) => {
        this.brokers = (res?.data || []).map((b) => ({ id: b.id, name: b.name }));
      },
      error: () => {
        this.brokers = [];
      }
    });
  }

  get filteredBrokers(): { id: string; name: string }[] {
    const q = (this.manualLoadForm.get('brokerName')?.value || '').toString().trim().toLowerCase();
    if (!q) return this.brokers.slice(0, 50);
    return this.brokers.filter((b) => b.name.toLowerCase().includes(q)).slice(0, 50);
  }

  selectBroker(broker: { id: string; name: string }): void {
    this.manualLoadForm.patchValue({ brokerId: broker.id, brokerName: broker.name });
    this.brokerDropdownOpen = false;
  }

  onBrokerInputFocus(): void {
    this.brokerDropdownOpen = true;
  }

  loadLoads(): void {
    this.loading = true;
    this.errorMessage = '';
    this.loadsService
      .listLoads({
        status: this.filters.status,
        billingStatus: this.filters.billingStatus,
        driverId: this.filters.driverId,
        q: this.filters.q,
        page: this.page,
        pageSize: this.pageSize,
        sortBy: this.sortBy,
        sortDir: this.sortDir
      })
      .subscribe({
        next: (res) => {
          this.loads = res?.data || [];
          this.total = res?.meta?.total || 0;
          this.loading = false;
        this.recomputeSummaryTotals();
        },
        error: () => {
          this.errorMessage = 'Failed to load loads.';
          this.loading = false;
        }
      });
  }

  onSearch(value: string): void {
    this.search$.next(value);
  }

  onFilterChange(): void {
    this.page = 1;
    this.loadLoads();
  }

  toggleSort(field: 'load_number' | 'pickup_date' | 'rate' | 'completed_date'): void {
    if (this.sortBy === field) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortBy = field;
      this.sortDir = 'asc';
    }
    this.loadLoads();
  }

  setStatusFilter(value: string): void {
    this.filters.status = value;
    this.page = 1;
    this.loadLoads();
  }

  setBillingFilter(value: string): void {
    this.filters.billingStatus = value;
    this.page = 1;
    this.loadLoads();
  }

  goToPage(page: number): void {
    if (page < 1) return;
    const maxPage = Math.max(Math.ceil(this.total / this.pageSize), 1);
    if (page > maxPage) return;
    this.page = page;
    this.loadLoads();
  }

  openManualEntry(): void {
    this.editingLoadId = null;
    this.editingLoadDetail = null;
    this.attachmentTab = 'documents';
    // Fresh manual entry should not carry over any pending attachments
    this.pendingAttachments = [];
    this.attachmentNotes = '';
    this.attachmentType = 'RATE_CONFIRMATION';
    this.attachmentError = '';
    this.selectedAttachmentFiles = null;
    this.resetManualForm();
    this.loadBrokers();
    this.showManualModal = true;
    this.showNewLoadMenu = false;
  }

  openAutoCreate(): void {
    this.autoPdfFile = null;
    this.autoExtracting = false;
    this.autoError = '';
    this.autoExtraction = null;
    this.showAutoModal = true;
    this.showNewLoadMenu = false;
  }

  closeManualModal(): void {
    this.showManualModal = false;
    this.showUploadModal = false;
    this.editingLoadId = null;
    this.editingLoadDetail = null;
  }

  closeAutoModal(): void {
    this.showAutoModal = false;
  }

  openDetails(load: LoadListItem): void {
    this.loadsService.getLoad(load.id).subscribe({
      next: (res) => {
        this.selectedLoad = res?.data || null;
        this.showDetailsModal = true;
      },
      error: () => {
        this.errorMessage = 'Failed to load details.';
      }
    });
  }

  closeDetails(): void {
    this.showDetailsModal = false;
    this.selectedLoad = null;
  }

  openEdit(load: LoadListItem): void {
    this.errorMessage = '';
    this.creatingLoad = false;
    this.loadsService.getLoad(load.id).subscribe({
      next: (res) => {
        const detail = res?.data;
        if (!detail) {
          this.errorMessage = 'Failed to load details for edit.';
          return;
        }
        this.editingLoadId = detail.id;
        this.editingLoadDetail = detail;
        this.attachmentTab = 'documents';
        this.populateFormFromDetail(detail);
        this.loadBrokers();
        this.showManualModal = true;
      },
      error: () => {
        this.errorMessage = 'Failed to load details for edit.';
      }
    });
  }

  private populateFormFromDetail(detail: LoadDetail): void {
    const normalizeDate = (value: unknown): string => {
      if (!value) return '';
      const d = value instanceof Date ? value : new Date(value as any);
      if (isNaN(d.getTime())) return '';
      return d.toISOString().slice(0, 10);
    };
    const pickup = (detail.stops || []).find((s) => (s.stop_type || '').toUpperCase() === 'PICKUP');
    const delivery = (detail.stops || []).find((s) => (s.stop_type || '').toUpperCase() === 'DELIVERY');

    // Prefer stop dates; if missing, fall back to top-level pickup/delivery dates
    const pickupDate = pickup?.stop_date
      ? normalizeDate(pickup.stop_date as any)
      : normalizeDate((detail as any).pickup_date);
    const deliveryDate = delivery?.stop_date
      ? normalizeDate(delivery.stop_date as any)
      : normalizeDate((detail as any).delivery_date);
    this.manualLoadForm.reset({
      status: detail.status,
      billingStatus: detail.billing_status,
      dispatcher: this.dispatcherName || '',
      pickupDate,
      pickupCity: pickup?.city || '',
      pickupState: pickup?.state || '',
      pickupZip: pickup?.zip || '',
      deliveryDate,
      deliveryCity: delivery?.city || '',
      deliveryState: delivery?.state || '',
      deliveryZip: delivery?.zip || '',
      driverId: detail.driver_id || '',
      truckId: detail.truck_id || '',
      trailerId: detail.trailer_id || '',
      brokerId: detail.broker_id || '',
      brokerName: detail.broker_name || '',
      poNumber: detail.po_number || '',
      rate: detail.rate ?? '',
      notes: detail.notes ?? ''
    });
    this.pickupCityEdited = false;
    this.pickupStateEdited = false;
    this.deliveryCityEdited = false;
    this.deliveryStateEdited = false;
  }

  resetManualForm(): void {
    this.manualLoadForm.reset({
      status: 'NEW',
      billingStatus: 'PENDING',
      dispatcher: this.dispatcherName || '',
      pickupDate: '',
      pickupCity: '',
      pickupState: '',
      pickupZip: '',
      deliveryDate: '',
      deliveryCity: '',
      deliveryState: '',
      deliveryZip: '',
      driverId: '',
      truckId: '',
      trailerId: '',
      brokerId: '',
      brokerName: '',
      poNumber: '',
      rate: '',
      notes: ''
    });
    this.pickupCityEdited = false;
    this.pickupStateEdited = false;
    this.deliveryCityEdited = false;
    this.deliveryStateEdited = false;
  }

  /** Apply extracted AI values into the manual load form for review. */
  private applyExtractionToForm(extraction: LoadAiEndpointExtraction): void {
    this.editingLoadId = null;
    this.editingLoadDetail = null;
    this.resetManualForm();

    const pickup = extraction.pickup || ({} as any);
    const delivery = extraction.delivery || ({} as any);

    this.manualLoadForm.patchValue({
      brokerName: extraction.brokerName || '',
      poNumber: extraction.poNumber || '',
      rate: extraction.rate != null ? extraction.rate : '',
      pickupDate: pickup.date || '',
      pickupCity: pickup.city || '',
      pickupState: pickup.state || '',
      pickupZip: pickup.zip || '',
      deliveryDate: delivery.date || '',
      deliveryCity: delivery.city || '',
      deliveryState: delivery.state || '',
      deliveryZip: delivery.zip || ''
    });
  }

  markPickupCityEdited(): void {
    this.pickupCityEdited = true;
  }

  markPickupStateEdited(): void {
    this.pickupStateEdited = true;
  }

  markDeliveryCityEdited(): void {
    this.deliveryCityEdited = true;
  }

  markDeliveryStateEdited(): void {
    this.deliveryStateEdited = true;
  }

  lookupPickupZip(): void {
    const zip = (this.manualLoadForm.value.pickupZip || '').toString().trim();
    if (zip.length !== 5) return;
    this.loadsService.lookupZip(zip).subscribe({
      next: (res) => {
        if (!this.pickupCityEdited) {
          this.manualLoadForm.patchValue({ pickupCity: res?.data?.city || '' });
        }
        if (!this.pickupStateEdited) {
          this.manualLoadForm.patchValue({ pickupState: res?.data?.state || '' });
        }
      }
    });
  }

  lookupDeliveryZip(): void {
    const zip = (this.manualLoadForm.value.deliveryZip || '').toString().trim();
    if (zip.length !== 5) return;
    this.loadsService.lookupZip(zip).subscribe({
      next: (res) => {
        if (!this.deliveryCityEdited) {
          this.manualLoadForm.patchValue({ deliveryCity: res?.data?.city || '' });
        }
        if (!this.deliveryStateEdited) {
          this.manualLoadForm.patchValue({ deliveryState: res?.data?.state || '' });
        }
      }
    });
  }

  setAttachmentFiles(files: FileList | null): void {
    this.selectedAttachmentFiles = files;
  }

  saveAttachment(): void {
    this.attachmentError = '';
    if (!this.selectedAttachmentFiles || this.selectedAttachmentFiles.length === 0) {
      this.attachmentError = 'Please select a file first.';
      return;
    }

    if (this.editingLoadId) {
      const loadId = this.editingLoadId;
      const notes = this.uploadAttachmentNotes || '';
      const uploads = Array.from(this.selectedAttachmentFiles).map((file) =>
        this.loadsService.uploadAttachment(loadId, file, this.uploadAttachmentType, notes)
      );
      let completed = 0;
      uploads.forEach((obs) => {
        obs.subscribe({
          next: () => {
            completed += 1;
            if (completed === uploads.length) {
              this.refreshEditingAttachments(loadId);
            }
          },
          error: () => {
            this.attachmentError = 'Failed to upload one or more attachments.';
          }
        });
      });
    } else {
      Array.from(this.selectedAttachmentFiles).forEach((file) => {
        this.pendingAttachments.push({
          file,
          type: this.uploadAttachmentType,
          notes: this.uploadAttachmentNotes || undefined
        });
      });
    }

    this.uploadAttachmentNotes = '';
    this.selectedAttachmentFiles = null;
    this.showUploadModal = false;
  }

  removeAttachment(index: number): void {
    this.pendingAttachments.splice(index, 1);
  }

  handleDrop(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer?.files?.length) {
      this.selectedAttachmentFiles = event.dataTransfer.files;
      this.saveAttachment();
    }
  }

  allowDrop(event: DragEvent): void {
    event.preventDefault();
  }

  private refreshEditingAttachments(loadId: string): void {
    this.loadsService.getLoad(loadId).subscribe({
      next: (res) => {
        this.editingLoadDetail = res?.data || this.editingLoadDetail;
      }
    });
  }

  validatePickupDelivery(): string[] {
    const errors: string[] = [];
    const pickupZip = (this.manualLoadForm.value.pickupZip || '').toString().trim();
    const pickupCity = (this.manualLoadForm.value.pickupCity || '').toString().trim();
    const pickupState = (this.manualLoadForm.value.pickupState || '').toString().trim();
    const deliveryZip = (this.manualLoadForm.value.deliveryZip || '').toString().trim();
    const deliveryCity = (this.manualLoadForm.value.deliveryCity || '').toString().trim();
    const deliveryState = (this.manualLoadForm.value.deliveryState || '').toString().trim();

    if (!(pickupZip || (pickupCity && pickupState))) {
      errors.push('Pickup ZIP or Pickup City/State is required.');
    }
    if (!(deliveryZip || (deliveryCity && deliveryState))) {
      errors.push('Delivery ZIP or Delivery City/State is required.');
    }
    return errors;
  }

  createLoad(): void {
    this.successMessage = '';
    this.errorMessage = '';
    this.manualLoadForm.markAllAsTouched();
    if (this.manualLoadForm.invalid) {
      const invalidFields: string[] = [];
      const controls = this.manualLoadForm.controls;
      if (controls['pickupDate']?.invalid) invalidFields.push('Pickup Date');
      if (controls['deliveryDate']?.invalid) invalidFields.push('Delivery Date');
      if (controls['status']?.invalid) invalidFields.push('Status');
      if (controls['billingStatus']?.invalid) invalidFields.push('Billing Status');
      if (controls['rate']?.invalid) invalidFields.push('Rate');

      this.errorMessage =
        invalidFields.length > 0
          ? `Please fix the following fields before submitting: ${invalidFields.join(', ')}.`
          : 'Please fix the validation errors before submitting.';
      return;
    }

    const validationErrors = this.validatePickupDelivery();
    if (validationErrors.length > 0) {
      this.errorMessage = validationErrors.join(' ');
      return;
    }

    const formValue = this.manualLoadForm.getRawValue();
    const stops: LoadStop[] = [
      {
        stop_type: 'PICKUP',
        stop_date: formValue.pickupDate,
        city: formValue.pickupCity,
        state: formValue.pickupState,
        zip: formValue.pickupZip,
        sequence: 1
      },
      {
        stop_type: 'DELIVERY',
        stop_date: formValue.deliveryDate,
        city: formValue.deliveryCity,
        state: formValue.deliveryState,
        zip: formValue.deliveryZip,
        sequence: 2
      }
    ];

    const payload = {
      status: formValue.status,
      billingStatus: formValue.billingStatus,
      dispatcherUserId: this.dispatcherUserId,
      driverId: formValue.driverId || null,
      truckId: formValue.truckId || null,
      trailerId: formValue.trailerId || null,
      brokerId: formValue.brokerId || null,
      brokerName: formValue.brokerName || null,
      poNumber: formValue.poNumber || null,
      rate: formValue.rate ? Number(formValue.rate) : 0,
      notes: formValue.notes || null,
      stops
    };

    this.creatingLoad = true;
    const isEdit = !!this.editingLoadId;
    const request$ = isEdit
      ? this.loadsService.updateLoad(this.editingLoadId as string, payload)
      : this.loadsService.createLoad(payload);

    request$.subscribe({
      next: (res) => {
        const load = res?.data;
        if (!load?.id) {
          this.creatingLoad = false;
          this.errorMessage = isEdit ? 'Failed to update load.' : 'Failed to create load.';
          return;
        }
        if (this.pendingAttachments.length === 0 || isEdit) {
          this.finishCreate(isEdit);
          return;
        }
        const uploads = this.pendingAttachments.map((item) =>
          this.loadsService.uploadAttachment(load.id, item.file, item.type, item.notes)
        );
        let uploaded = 0;
        uploads.forEach((obs) => {
          obs.subscribe({
            next: () => {
              uploaded += 1;
              if (uploaded === uploads.length) {
                this.finishCreate(isEdit);
              }
            },
            error: () => {
              this.errorMessage = 'Load created, but attachment upload failed.';
              this.finishCreate(isEdit);
            }
          });
        });
      },
      error: () => {
        this.creatingLoad = false;
        this.errorMessage = isEdit ? 'Failed to update load.' : 'Failed to create load.';
      }
    });
  }

  finishCreate(isEdit: boolean): void {
    this.creatingLoad = false;
    this.successMessage = isEdit ? 'Load updated successfully.' : 'Load created successfully.';
    this.editingLoadId = null;
    this.closeManualModal();
    this.loadLoads();
    setTimeout(() => {
      this.successMessage = '';
    }, 4000);
  }

  rowClass(load: LoadListItem): string {
    const status = (load.status || '').toString().toUpperCase();
    if (status === 'DELIVERED') return 'row-delivered';
    if (status === 'CANCELLED') return 'row-cancelled';
    return '';
  }

  /** Build full URL for attachment download (backend serves /uploads). */
  getAttachmentUrl(att: { file_url?: string | null }): string {
    if (!att?.file_url) return '';
    const base = environment.apiUrl.replace(/\/api\/?$/, '');
    return base + (att.file_url.startsWith('/') ? att.file_url : '/' + att.file_url);
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.showNewLoadMenu = false;
    this.actionsOpenLoadId = null;
    this.brokerDropdownOpen = false;
  }

  // Auto-create from PDF handlers

  onAutoFileSelected(files: FileList | null): void {
    this.autoError = '';
    this.autoPdfFile = files && files.length > 0 ? files[0] : null;
  }

  runAutoExtraction(): void {
    this.autoError = '';
    if (!this.autoPdfFile) {
      this.autoError = 'Please select a PDF file first.';
      return;
    }
    this.autoExtracting = true;
    this.loadsService.aiExtractFromPdf(this.autoPdfFile).subscribe({
      next: (res) => {
        this.autoExtracting = false;
        const data = res?.data;
        if (!data) {
          this.autoError = 'Extraction returned no data. You can continue with manual entry.';
          // Queue attachment and open manual entry anyway
          this.pendingAttachments.push({
            file: this.autoPdfFile as File,
            type: 'RATE_CONFIRMATION',
            notes: 'Uploaded via Auto-Create'
          });
          this.showAutoModal = false;
          this.showManualModal = true;
          return;
        }
        this.autoExtraction = data;

        // If the backend reports no text / vision-only PDF, surface that clearly.
        if (data.provider === 'none' && data.warning) {
          this.autoError = data.warning;
          // Attach the PDF but keep the user in manual mode.
          this.pendingAttachments.push({
            file: this.autoPdfFile as File,
            type: 'RATE_CONFIRMATION',
            notes: 'Rate confirmation (scanned PDF - manual entry)'
          });
          this.showAutoModal = false;
          this.showManualModal = true;
          return;
        }

        // Normal case: we have structured extraction to apply.
        this.pendingAttachments.push({
          file: this.autoPdfFile as File,
          type: 'RATE_CONFIRMATION',
          notes: 'Rate confirmation (Auto-Create PDF)'
        });
        this.applyExtractionToForm(data);
        this.showAutoModal = false;
        this.showManualModal = true;
      },
      error: (err) => {
        console.error('AI extract failed', err);
        this.autoExtracting = false;
        this.autoError =
          'Failed to extract from PDF. You can still create the load manually and the PDF will be attached.';
        // Still attach the PDF and open manual entry so the user can continue.
        if (this.autoPdfFile) {
          this.pendingAttachments.push({
            file: this.autoPdfFile,
            type: 'RATE_CONFIRMATION',
            notes: 'Rate confirmation (Auto-Create PDF)'
          });
        }
        this.showAutoModal = false;
        this.showManualModal = true;
      }
    });
  }

  // Recompute gross totals on the current page for dashboard summary
  private recomputeSummaryTotals(): void {
    const byStatus: { [key: string]: number } = {};
    const byBilling: { [key: string]: number } = {};
    let total = 0;

    (this.loads || []).forEach((load) => {
      const rate = load.rate != null ? Number(load.rate) : 0;
      total += rate;
      const statusKey = (load.status || '').toString().toUpperCase();
      const billingKey = (load.billing_status || '').toString().toUpperCase();
      if (statusKey) {
        byStatus[statusKey] = (byStatus[statusKey] || 0) + rate;
      }
      if (billingKey) {
        byBilling[billingKey] = (byBilling[billingKey] || 0) + rate;
      }
    });

    this.summaryTotals = {
      totalGross: total,
      byStatus,
      byBilling
    };
  }

  // Apply header row filters client-side on the current page of loads
  get filteredLoads(): LoadListItem[] {
    const hf = this.headerFilters;
    return (this.loads || []).filter((load) => {
      // Date filter on pickup_date or delivery/completed date
      if (hf.date) {
        const dateStr = (load.pickup_date || load.delivery_date || load.completed_date || '').toString();
        if (!dateStr.includes(hf.date)) return false;
      }

      if (hf.broker) {
        const broker = (load.broker_name || '').toString().toLowerCase();
        if (!broker.includes(hf.broker.toLowerCase())) return false;
      }

      if (hf.po) {
        const po = (load.po_number || '').toString().toLowerCase();
        if (!po.includes(hf.po.toLowerCase())) return false;
      }

      if (hf.pickup) {
        const pickupLoc = `${load.pickup_city || ''} ${load.pickup_state || ''}`.toLowerCase();
        if (!pickupLoc.includes(hf.pickup.toLowerCase())) return false;
      }

      if (hf.delivery) {
        const deliveryLoc = `${load.delivery_city || ''} ${load.delivery_state || ''}`.toLowerCase();
        if (!deliveryLoc.includes(hf.delivery.toLowerCase())) return false;
      }

      if (hf.rate) {
        const rateStr = load.rate != null ? String(load.rate) : '';
        if (!rateStr.includes(hf.rate)) return false;
      }

      if (hf.notes) {
        const notes = (load.notes || '').toString().toLowerCase();
        if (!notes.includes(hf.notes.toLowerCase())) return false;
      }

      if (hf.attachmentType) {
        const types = Array.isArray(load.attachment_types) ? load.attachment_types : [];
        if (!types.includes(hf.attachmentType as any)) return false;
      }

      return true;
    });
  }
}
