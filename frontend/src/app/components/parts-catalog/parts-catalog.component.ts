import { Component, OnDestroy, OnInit, ViewChild, ElementRef } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { combineLatest, Observable, of, Subject, Subscription } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap, takeUntil } from 'rxjs/operators';
import { ManufacturersService, MasterEntity } from '../../services/manufacturers.service';
import { VendorsService } from '../../services/vendors.service';
import { MasterTypeaheadValue } from '../shared/master-typeahead/master-typeahead.component';
import {
  AiPartsService,
  BulkCreateResponse,
  InvoiceAiResult,
  PartConfidence,
} from '../../services/ai-parts.service';
import { DuplicateCandidate } from './duplicate-warning/duplicate-warning.component';

@Component({
  selector: 'app-parts-catalog',
  templateUrl: './parts-catalog.component.html',
  styleUrls: ['./parts-catalog.component.css']
})
export class PartsCatalogComponent implements OnInit, OnDestroy {
  parts: any[] = [];
  filteredParts: any[] = [];
  categories: string[] = [];
  manufacturers: string[] = [];

  userRole: string | null = null;

  showForm = false;
  editingPartId: string | null = null;
  partForm: FormGroup;

  searchTerm = '';
  selectedCategory = '';
  selectedManufacturer = '';

  successMessage = '';
  errorMessage = '';
  loading = false;
  bulkUploading = false;
  bulkUploadSummary: { created?: number; updated?: number; skipped?: number; errors?: Array<{ row?: number; sku?: string; error?: string }> } | null = null;

  // ── FN-708: Stock breakdown per part ────────────────────────────────────────
  /** The part.id whose stock breakdown row is currently expanded (null = none). */
  expandedStockPartId: string | null = null;
  /** Cache: partId → inventory lines across all locations. */
  private stockCache = new Map<string, any[]>();
  /** partId currently being fetched. */
  stockLoadingForId: string | null = null;
  stockLoadError: string | null = null;
  // ─────────────────────────────────────────────────────────────────────────────

  aiAnalysisLoading = false;
  aiAnalysisError = '';
  aiAnalysisResult: {
    summary: string;
    insights: Array<{ type: string; title: string; message: string; partSkus?: string[] }>;
    recommendations: Array<{ action: string; detail: string; partSkus?: string[] }>;
  } | null = null;

  /** Filter for AI analysis: '' = all, or insight/rec type */
  aiFilterType = '';
  /** Search within AI analysis parts */
  aiSearchText = '';

  /** Master-typeahead values bound to the modal (kept in sync with form FK + text fields). */
  manufacturerValue: MasterTypeaheadValue | null = null;
  vendorValue: MasterTypeaheadValue | null = null;

  // ── FN-1099: Quick Add → Snap Photo ─────────────────────────────────────────
  /** Whether the Quick Add dropdown menu is open. */
  quickAddOpen = false;
  /** AI photo intake in flight — drives the spinner overlay + Cancel button. */
  aiBusy = false;
  /**
   * Per-field confidence scores for the currently-prefilled modal. Cleared
   * when the user edits the field (badge disappears once typing starts).
   */
  aiConfidence: Partial<Record<'manufacturer' | 'partNumber' | 'category' | 'description' | 'dimensions', number>> = {};
  /** R2 key returned by /api/ai/parts/identify-from-photo — sent on Save. */
  aiR2Key: string | null = null;
  /** Warnings the model surfaced (low-confidence indicators, partial reads). */
  aiWarnings: string[] = [];
  /** Cancel signal for the in-flight AI request. */
  private aiCancel$ = new Subject<void>();
  /** Subscription so the photo flow doesn't leak observers across modals. */
  private aiPhotoSub: Subscription | null = null;
  /** Lifecycle teardown for editsToFieldClearBadge listeners. */
  private destroy$ = new Subject<void>();
  @ViewChild('snapPhotoInput') snapPhotoInput!: ElementRef<HTMLInputElement>;
  // ─────────────────────────────────────────────────────────────────────────────

  // ── FN-1107: Quick Add → Scan Barcode ───────────────────────────────────────
  /** Whether the Scan Barcode dialog is open. */
  scannerOpen = false;
  /** Lookup error pushed back into the dialog so it stays open on transient/server errors. */
  scannerError: string | null = null;
  /** True while a barcode lookup is in flight. Drives the dialog's busy state. */
  scannerBusy = false;
  /** True when the Add modal was opened from a no-match scan — locks the barcode field. */
  barcodePrefilled = false;
  // ─────────────────────────────────────────────────────────────────────────────

  // ── FN-1111: Live duplicate detection + auto-SKU ────────────────────────────
  /** Candidates from the most recent /api/parts/duplicate-check call. */
  duplicateCandidates: DuplicateCandidate[] = [];
  /**
   * Once the user clicks "Ignore — this is a new part" we suppress the
   * warning for the rest of the modal session. Reset whenever the modal
   * opens (closeForm clears it).
   */
  duplicateWarningDismissed = false;
  /** Debounce window for typing → duplicate-check requests. */
  static readonly DUPLICATE_CHECK_DEBOUNCE_MS = 350;
  /** Subscription for the debounced duplicate-check pipeline. */
  private duplicateCheckSub: Subscription | null = null;
  /** Whether the SKU field was explicitly populated by Generate-SKU. */
  generateSkuBusy = false;
  // ─────────────────────────────────────────────────────────────────────────────

  // ── FN-1104: Quick Add → Scan Invoice ───────────────────────────────────────
  /** Whether the Scan Invoice review modal is open. */
  invoiceModalOpen = false;
  /** AI extraction shown in the review modal (null until upload returns). */
  invoiceAiResult: InvoiceAiResult | null = null;
  /** R2 key for the uploaded invoice — held for audit-trail wiring. */
  invoiceR2Key = '';
  /** Set of catalog SKUs (uppercase) so the modal can flag known SKUs. */
  invoiceExistingSkus: Set<string> = new Set<string>();
  /** Cancel signal for the in-flight invoice extraction request. */
  private invoiceCancel$ = new Subject<void>();
  private invoiceSub: Subscription | null = null;
  @ViewChild('scanInvoiceInput') scanInvoiceInput!: ElementRef<HTMLInputElement>;
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Bound once at construction so the OnPush typeahead receives stable Input
   * references (FN-317 RCA: fresh per-CD references trap OnPush in re-renders).
   */
  readonly searchManufacturers = (q: string): Observable<MasterEntity[]> =>
    this.manufacturersService.search(q);
  readonly createManufacturer = (name: string): Observable<MasterEntity> =>
    this.manufacturersService.create(name);
  readonly searchVendors = (q: string): Observable<MasterEntity[]> =>
    this.vendorsService.search(q);
  readonly createVendor = (name: string): Observable<MasterEntity> =>
    this.vendorsService.create(name);

  constructor(
    private apiService: ApiService,
    private fb: FormBuilder,
    private manufacturersService: ManufacturersService,
    private vendorsService: VendorsService,
    private aiPartsService: AiPartsService,
  ) {
    this.partForm = this.fb.group({
      sku: ['', [Validators.required]],
      name: ['', Validators.required],
      category: ['', Validators.required],
      // Free-text manufacturer is preserved on the wire — the BE keeps it in
      // sync with manufacturer_id (FN-1093). The typeahead drives both fields.
      manufacturer: ['', Validators.required],
      manufacturer_id: [null as number | null],
      preferred_vendor_name: [''],
      vendor_id: [null as number | null],
      uom: ['each'],
      unit_cost: [0, Validators.required],
      unit_price: [0],
      description: [''],
      barcode: [''],
      quantity_on_hand: [0],
      reorder_level: [5],
      supplier_id: [''],
      notes: ['']
    });
  }

  ngOnInit(): void {
    const role = localStorage.getItem('role');
    this.userRole = role ? role.toLowerCase().trim() : null;
    this.loadParts();
    this.loadCategories();
    this.loadManufacturers();
    this.wireBadgeClearOnEdit();
    this.wireDuplicateCheck();
  }

  ngOnDestroy(): void {
    this.cancelAiPhoto();
    this.cancelAiInvoice();
    this.duplicateCheckSub?.unsubscribe();
    this.duplicateCheckSub = null;
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * When the user types into a prefilled field, drop its AI confidence so
   * the badge clears. Manufacturer is special — its value comes from the
   * typeahead (onManufacturerPick), so we clear that one there.
   */
  /**
   * FN-1111: Watch name/sku/manufacturer in the Add form and call
   * /api/parts/duplicate-check after a 350ms quiet window. The pipeline:
   *   - debounceTime(350) — collapse rapid keystrokes
   *   - distinctUntilChanged on the trio — skip no-op CD ticks
   *   - filter — only fire when (a) Add mode (no editingPartId), (b) the
   *     warning has not been dismissed for this session, and (c) at least
   *     one of name/sku/manufacturer is non-empty (BE 400s otherwise)
   *   - switchMap to the API, swallow errors so a transient failure does
   *     not poison the stream (the user can keep typing and we'll retry on
   *     the next change)
   *
   * The subscription lives for the component lifetime; subscribing here
   * (not on form-open) avoids a races-with-modal-close subscription leak.
   */
  private wireDuplicateCheck(): void {
    this.duplicateCheckSub?.unsubscribe();

    const name$ = this.partForm.get('name')!.valueChanges;
    const sku$ = this.partForm.get('sku')!.valueChanges;
    const mfg$ = this.partForm.get('manufacturer')!.valueChanges;

    this.duplicateCheckSub = combineLatest([
      name$, sku$, mfg$,
    ]).pipe(
      map(([name, sku, manufacturer]) => ({
        name: String(name || '').trim(),
        sku: String(sku || '').trim(),
        manufacturer: String(manufacturer || '').trim(),
      })),
      debounceTime(PartsCatalogComponent.DUPLICATE_CHECK_DEBOUNCE_MS),
      distinctUntilChanged((a, b) =>
        a.name === b.name && a.sku === b.sku && a.manufacturer === b.manufacturer,
      ),
      switchMap(query => {
        const eligible =
          this.editingPartId === null &&
          !this.duplicateWarningDismissed &&
          (query.name || query.sku || query.manufacturer);
        if (!eligible) {
          return of<DuplicateCandidate[]>([]);
        }
        return this.apiService.duplicateCheckParts({ ...query, limit: 5 }).pipe(
          map((res: any) => Array.isArray(res?.data) ? (res.data as DuplicateCandidate[]) : []),
          catchError(() => of<DuplicateCandidate[]>([])),
        );
      }),
      takeUntil(this.destroy$),
    ).subscribe(candidates => {
      this.duplicateCandidates = candidates;
    });
  }

  private wireBadgeClearOnEdit(): void {
    const fields: Array<{ control: string; ai: keyof PartConfidence }> = [
      // SKU is the FE binding for the AI's partNumber suggestion (the model
      // returns the printed part-number text; the form has no separate field).
      { control: 'sku',         ai: 'partNumber' },
      { control: 'category',    ai: 'category' },
      { control: 'description', ai: 'description' },
    ];
    for (const { control, ai } of fields) {
      this.partForm.get(control)?.valueChanges
        .pipe(takeUntil(this.destroy$))
        .subscribe(() => {
          if (this.aiConfidence[ai] !== undefined) {
            this.aiConfidence = { ...this.aiConfidence, [ai]: undefined };
          }
        });
    }
  }

  loadParts(filters?: any): void {
    this.loading = true;
    this.apiService.getParts(filters).subscribe({
      next: (response: any) => {
        this.parts = response.data || [];
        this.applyFilters();
        this.refreshInvoiceExistingSkus();
        this.loading = false;
      },
      error: (error: any) => {
        this.errorMessage = `Failed to load parts: ${error.error?.error || error.message}`;
        this.loading = false;
      }
    });
  }

  /** Build the lookup the Scan Invoice modal uses to flag known SKUs. */
  private refreshInvoiceExistingSkus(): void {
    const next = new Set<string>();
    for (const p of this.parts) {
      if (p?.sku) next.add(String(p.sku).trim().toUpperCase());
    }
    this.invoiceExistingSkus = next;
  }

  loadCategories(): void {
    this.apiService.getPartCategories().subscribe({
      next: (response: any) => {
        this.categories = response.data || [];
      },
      error: (error: any) => console.error('Failed to load categories:', error)
    });
  }

  loadManufacturers(): void {
    this.apiService.getPartManufacturers().subscribe({
      next: (response: any) => {
        this.manufacturers = response.data || [];
      },
      error: (error: any) => console.error('Failed to load manufacturers:', error)
    });
  }

  applyFilters(): void {
    let filtered = [...this.parts];

    if (this.searchTerm) {
      const search = this.searchTerm.toLowerCase();
      filtered = filtered.filter(p =>
        p.sku.toLowerCase().includes(search) ||
        p.name.toLowerCase().includes(search)
      );
    }

    if (this.selectedCategory) {
      filtered = filtered.filter(p => p.category === this.selectedCategory);
    }

    if (this.selectedManufacturer) {
      filtered = filtered.filter(p => p.manufacturer === this.selectedManufacturer);
    }

    this.filteredParts = filtered;
  }

  onSearch(term: string): void {
    this.searchTerm = term;
    this.applyFilters();
  }

  onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.onSearch(target?.value ?? '');
  }

  onCategoryChange(category: string): void {
    this.selectedCategory = category;
    this.applyFilters();
  }

  onCategorySelect(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    this.onCategoryChange(target?.value ?? '');
  }

  onManufacturerChange(manufacturer: string): void {
    this.selectedManufacturer = manufacturer;
    this.applyFilters();
  }

  onManufacturerSelect(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    this.onManufacturerChange(target?.value ?? '');
  }

  openForm(part?: any): void {
    if (part) {
      this.editingPartId = part.id;
      this.partForm.patchValue(part);
      // Hydrate the typeaheads. If the part has a FK we trust it; if it only
      // has the legacy free-text we still display it and let the BE upgrade
      // it to a FK on save (FN-1093 resolveManufacturerVendor).
      this.manufacturerValue = part.manufacturer || part.manufacturer_id != null
        ? { id: part.manufacturer_id ?? null, name: part.manufacturer ?? '' }
        : null;
      this.vendorValue = part.preferred_vendor_name || part.vendor_id != null
        ? { id: part.vendor_id ?? null, name: part.preferred_vendor_name ?? '' }
        : null;
    } else {
      this.editingPartId = null;
      this.partForm.reset({ uom: 'each', unit_cost: 0, unit_price: 0, quantity_on_hand: 0, reorder_level: 5 });
      this.manufacturerValue = null;
      this.vendorValue = null;
    }
    this.showForm = true;
    this.successMessage = '';
    this.errorMessage = '';
    this.duplicateCandidates = [];
    this.duplicateWarningDismissed = false;
  }

  onManufacturerPick(value: MasterTypeaheadValue): void {
    this.manufacturerValue = value;
    this.partForm.patchValue({
      manufacturer: value.name,
      manufacturer_id: value.id,
    });
    this.partForm.get('manufacturer')?.markAsDirty();
    // The user has confirmed a master record (or chosen "create new") —
    // the AI suggestion is no longer authoritative, drop the badge.
    if (this.aiConfidence.manufacturer !== undefined) {
      this.aiConfidence = { ...this.aiConfidence, manufacturer: undefined };
    }
  }

  onVendorPick(value: MasterTypeaheadValue): void {
    this.vendorValue = value;
    this.partForm.patchValue({
      preferred_vendor_name: value.name,
      vendor_id: value.id,
    });
    this.partForm.get('preferred_vendor_name')?.markAsDirty();
  }

  openFormModal(part?: any): void {
    this.openForm(part);
  }

  closeForm(): void {
    this.showForm = false;
    this.editingPartId = null;
    this.partForm.reset();
    this.manufacturerValue = null;
    this.vendorValue = null;
    this.aiConfidence = {};
    this.aiR2Key = null;
    this.aiWarnings = [];
    this.barcodePrefilled = false;
    this.duplicateCandidates = [];
    this.duplicateWarningDismissed = false;
  }

  // ── FN-1111: duplicate-warning + auto-SKU handlers ──────────────────────────

  /** Whether the inline duplicate warning should render right now. */
  get showDuplicateWarning(): boolean {
    return (
      this.editingPartId === null &&
      !this.duplicateWarningDismissed &&
      this.duplicateCandidates.length > 0
    );
  }

  /** "Edit existing" link → close Add modal, reopen as Edit for that part. */
  onEditExistingDuplicate(candidate: DuplicateCandidate): void {
    this.apiService.getPartById(candidate.id).subscribe({
      next: (response: any) => {
        const full = response?.data ?? response;
        this.closeForm();
        this.openForm(full || candidate);
      },
      error: () => {
        // If we can't load the full record, fall back to the candidate
        // payload we already have — the Edit modal will gracefully accept
        // partial fields and the BE will fill the rest on save.
        this.closeForm();
        this.openForm(candidate);
      },
    });
  }

  /** "Ignore — this is a new part" → suppress the warning for the rest of this Add session. */
  onDismissDuplicateWarning(): void {
    this.duplicateWarningDismissed = true;
    this.duplicateCandidates = [];
  }

  /**
   * Build a `<MFG>-<CAT>-<NNNN>` SKU from the manufacturer + category
   * fields. The 4-digit counter is collision-checked against the parts
   * already loaded into memory and retried up to 10 times. Falls back to
   * a sequential search if random retries keep colliding.
   */
  generateSku(): void {
    if (this.generateSkuBusy) return;
    const manufacturer = String(this.partForm.value.manufacturer || '').trim();
    const category = String(this.partForm.value.category || '').trim();
    if (!manufacturer || !category) {
      this.errorMessage = 'Pick a manufacturer and category before generating a SKU.';
      return;
    }
    this.errorMessage = '';

    const mfg = this.toAbbrev(manufacturer);
    const cat = this.toAbbrev(category);
    const taken = new Set<string>(
      (this.parts || []).map((p: any) => String(p.sku || '').trim().toUpperCase()),
    );

    this.generateSkuBusy = true;
    try {
      let candidate = '';
      // Random retry up to 10 attempts; if everything collides fall back to
      // a deterministic scan (unlikely at the scale of a single tenant).
      for (let i = 0; i < 10; i++) {
        const nnnn = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
        const next = `${mfg}-${cat}-${nnnn}`;
        if (!taken.has(next.toUpperCase())) {
          candidate = next;
          break;
        }
      }
      if (!candidate) {
        for (let n = 0; n < 10000; n++) {
          const nnnn = String(n).padStart(4, '0');
          const next = `${mfg}-${cat}-${nnnn}`;
          if (!taken.has(next.toUpperCase())) {
            candidate = next;
            break;
          }
        }
      }

      if (candidate) {
        // emitEvent: true so the duplicate-check pipeline sees the new SKU.
        this.partForm.patchValue({ sku: candidate });
        this.partForm.get('sku')?.markAsDirty();
      } else {
        this.errorMessage = 'Could not generate a unique SKU — all 10000 slots taken for this manufacturer/category.';
      }
    } finally {
      this.generateSkuBusy = false;
    }
  }

  /**
   * Take the first three alphanumeric letters of a label and uppercase
   * them. e.g. "Fleetguard" → "FLE", "Oil Filter" → "OIL", "AC" → "AC".
   * Falls back to "GEN" if no letters survive (purely numeric input).
   */
  private toAbbrev(value: string): string {
    const cleaned = (value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!cleaned) return 'GEN';
    return cleaned.slice(0, 3);
  }
  // ─────────────────────────────────────────────────────────────────────────────

  savePart(): void {
    if (!this.partForm.valid) {
      this.errorMessage = 'Please fill in all required fields';
      return;
    }

    this.loading = true;
    const formData: any = this.partForm.value;
    if (this.aiR2Key) {
      // FN-1098 BE accepts image_r2_key on create/update and persists into parts.image_url.
      formData.image_r2_key = this.aiR2Key;
    }

    if (this.editingPartId) {
      // Update
      this.apiService.updatePart(this.editingPartId, formData).subscribe({
        next: (response: any) => {
          this.successMessage = response.message || 'Part updated successfully';
          this.loadParts();
          this.closeForm();
          setTimeout(() => this.successMessage = '', 3000);
          this.loading = false;
        },
        error: (error: any) => {
          this.errorMessage = `Failed to update part: ${error.error?.error || error.message}`;
          this.loading = false;
        }
      });
    } else {
      // Create
      this.apiService.createPart(formData).subscribe({
        next: (response: any) => {
          this.successMessage = response.message || 'Part created successfully';
          this.loadParts();
          this.closeForm();
          setTimeout(() => this.successMessage = '', 3000);
          this.loading = false;
        },
        error: (error: any) => {
          this.errorMessage = `Failed to create part: ${error.error?.error || error.message}`;
          this.loading = false;
        }
      });
    }
  }

  deactivatePart(id: string): void {
    if (!confirm('Are you sure you want to deactivate this part?')) {
      return;
    }

    this.loading = true;
    this.apiService.deactivatePart(id).subscribe({
      next: (response: any) => {
        this.successMessage = response.message || 'Part deactivated successfully';
        this.loadParts();
        setTimeout(() => this.successMessage = '', 3000);
        this.loading = false;
      },
      error: (error: any) => {
        this.errorMessage = `Failed to deactivate part: ${error.error?.error || error.message}`;
        this.loading = false;
      }
    });
  }

  downloadTemplate(): void {
    this.errorMessage = '';
    this.apiService.downloadPartsTemplate().subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'parts-upload-template.xlsx';
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      },
      error: (_error: any) => {
        // Fallback: generate CSV template in browser (works even if API is unreachable)
        const headers = [
          'sku',
          'name',
          'category',
          'manufacturer',
          'uom',
          'unit_cost',
          'unit_price',
          'reorder_level',
          'description',
          'barcode',
          'pack_qty',
          'vendor',
          'status'
        ];
        const sample = [
          'TRK-001',
          'Oil Filter - Cummins ISX',
          'Engine',
          'Fleetguard',
          'each',
          '12.50',
          '19.99',
          '5',
          'Heavy duty oil filter',
          'TRK-001',
          '1',
          'Fleetguard',
          'ACTIVE'
        ];

        const escapeCsv = (value: string) => {
          const v = String(value ?? '');
          return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        };

        const csv = [headers, sample]
          .map(row => row.map(escapeCsv).join(','))
          .join('\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'parts-upload-template.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);

        this.successMessage = 'Template downloaded as CSV (fallback mode).';
      }
    });
  }

  onBulkFileSelected(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    const file = target?.files?.[0];
    if (!file) return;

    this.bulkUploading = true;
    this.bulkUploadSummary = null;
    this.errorMessage = '';
    this.successMessage = '';

    this.apiService.bulkUploadParts(file).subscribe({
      next: (response: any) => {
        this.bulkUploadSummary = response?.data || null;
        this.successMessage = response?.message || 'Bulk upload completed successfully';
        this.loadParts();
        this.loadCategories();
        this.loadManufacturers();
        this.bulkUploading = false;
        if (target) target.value = '';
      },
      error: (error: any) => {
        this.errorMessage = `Bulk upload failed: ${error.error?.error || error.message}`;
        this.bulkUploading = false;
        if (target) target.value = '';
      }
    });
  }

  getBulkUploadErrors(): Array<{ row?: number; sku?: string; error?: string }> {
    return Array.isArray(this.bulkUploadSummary?.errors) ? this.bulkUploadSummary!.errors! : [];
  }

  /** Map SKU to part name for display. */
  getPartName(sku: string): string {
    const part = (this.parts || []).find((p: any) => String(p.sku).toLowerCase() === String(sku).toLowerCase());
    return part?.name || sku;
  }

  /** All unique insight + recommendation types for filter. */
  get aiFilterTypes(): { value: string; label: string }[] {
    const types = new Set<string>();
    (this.aiAnalysisResult?.insights || []).forEach(i => { if (i.type) types.add(i.type); });
    (this.aiAnalysisResult?.recommendations || []).forEach(r => {
      const t = (r as any).type;
      if (t) types.add(t);
    });
    const options = [{ value: '', label: 'All issues' }];
    const labelMap = (t: string) => this.getInsightLabel(t);
    Array.from(types).sort().forEach(t => options.push({ value: t, label: labelMap(t) }));
    return options;
  }

  getInsightLabel(type: string): string {
    const map: Record<string, string> = {
      ZERO_STOCK: 'Out of stock',
      LOW_STOCK: 'Running low',
      HIGH_COST_LOW_STOCK: 'Expensive & low stock',
      CATEGORY_SPREAD: 'Category spread',
      MANUFACTURER_DISTRIBUTION: 'Manufacturer mix',
    };
    return map[type] || type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  /** Parts for an insight/rec, with names, optionally filtered by search. */
  getPartDisplayList(skus: string[] | undefined): { sku: string; name: string }[] {
    if (!skus?.length) return [];
    const search = (this.aiSearchText || '').toLowerCase();
    const list = skus.map(sku => ({ sku, name: this.getPartName(sku) }));
    if (!search) return list;
    return list.filter(p => p.name.toLowerCase().includes(search) || p.sku.toLowerCase().includes(search));
  }

  /** Filtered insights for display. */
  get filteredInsights() {
    const list = this.aiAnalysisResult?.insights || [];
    if (!this.aiFilterType) return list;
    return list.filter(i => i.type === this.aiFilterType);
  }

  /** Filtered recommendations for display. (Show all; insights are filtered by type.) */
  get filteredRecommendations() {
    return this.aiAnalysisResult?.recommendations || [];
  }

  // ── FN-708: Stock breakdown methods ──────────────────────────────────────────

  /**
   * Toggle the stock breakdown row for a part.
   * First toggle loads from the API; subsequent toggles use the cache.
   */
  toggleStockBreakdown(part: any): void {
    if (this.expandedStockPartId === part.id) {
      // Collapse
      this.expandedStockPartId = null;
      this.stockLoadError = null;
      return;
    }

    this.expandedStockPartId = part.id;
    this.stockLoadError = null;

    // Already cached — nothing to fetch
    if (this.stockCache.has(part.id)) return;

    this.stockLoadingForId = part.id;
    this.apiService.getInventoryByPart(part.id).subscribe({
      next: (res: any) => {
        const lines: any[] = Array.isArray(res) ? res : (res?.data ?? []);
        this.stockCache.set(part.id, lines);
        this.stockLoadingForId = null;
      },
      error: (err: any) => {
        this.stockLoadError = err?.error?.error ?? err?.message ?? 'Failed to load stock.';
        this.stockLoadingForId = null;
      }
    });
  }

  /** Returns cached stock lines for a part, or [] if not yet loaded. */
  getStockLines(partId: string): any[] {
    return this.stockCache.get(partId) ?? [];
  }

  /**
   * Produce a compact comma-separated summary for all stock lines of a part.
   * Example: "SHOP-A (A-3): 5 units, WAREHOUSE-1 (W-27): 20 units"
   */
  getStockSummary(partId: string): string {
    const lines = this.stockCache.get(partId) ?? [];
    if (!lines.length) return '—';
    return lines.map(l => this.formatStockLine(l)).join(', ');
  }

  /**
   * Format one stock line into a human-readable summary pill.
   * Pattern: "Location Name (BIN-CODE): 5 units"
   * Falls back to bin_location text if no bin_code.
   */
  formatStockLine(item: any): string {
    const location = item.location_name || item.location_id || '—';
    const binPart  = item.bin_code
      ? `(${item.bin_code})`
      : item.bin_location
        ? `(${item.bin_location})`
        : '';
    const qty = Number(item.on_hand_qty ?? item.available_qty ?? 0);
    return binPart
      ? `${location} ${binPart}: ${qty} units`
      : `${location}: ${qty} units`;
  }

  loadAiAnalysis(): void {
    this.aiAnalysisError = '';
    this.aiAnalysisResult = null;
    this.aiAnalysisLoading = true;
    const parts = (this.parts || []).map((p: any) => ({
      sku: p.sku,
      name: p.name,
      category: p.category,
      manufacturer: p.manufacturer,
      unit_cost: p.unit_cost,
      unit_price: p.unit_price,
      quantity_on_hand: p.quantity_on_hand,
      reorder_level: p.reorder_level,
      status: p.status
    }));
    this.apiService.getPartsAnalysis({
      parts,
      categories: this.categories || [],
      manufacturers: this.manufacturers || []
    }).subscribe({
      next: (res: any) => {
        this.aiAnalysisResult = {
          summary: res?.summary || '',
          insights: res?.insights || [],
          recommendations: res?.recommendations || []
        };
        this.aiAnalysisLoading = false;
      },
      error: (err: any) => {
        this.aiAnalysisError = err?.error?.error || err?.message || 'AI analysis unavailable.';
        this.aiAnalysisLoading = false;
      }
    });
  }

  // ── FN-1099: Quick Add → Snap Photo ─────────────────────────────────────────

  toggleQuickAdd(): void {
    this.quickAddOpen = !this.quickAddOpen;
  }

  closeQuickAdd(): void {
    this.quickAddOpen = false;
  }

  /** Trigger the hidden file input (uses capture=environment on mobile). */
  startSnapPhoto(): void {
    this.closeQuickAdd();
    if (!this.snapPhotoInput?.nativeElement) return;
    // Reset value so the same file can be re-selected back-to-back.
    this.snapPhotoInput.nativeElement.value = '';
    this.snapPhotoInput.nativeElement.click();
  }

  /**
   * File-input change handler. Uploads to /api/ai/parts/identify-from-photo,
   * then opens the Add Part modal — prefilled on success, empty + toast
   * on failure (so the user can fill manually).
   */
  onSnapPhotoSelected(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    const file = target?.files?.[0];
    if (!file) return;

    this.errorMessage = '';
    this.successMessage = '';
    this.aiBusy = true;
    this.aiCancel$ = new Subject<void>();

    this.aiPhotoSub?.unsubscribe();
    this.aiPhotoSub = this.aiPartsService
      .identifyFromPhoto(file)
      .pipe(takeUntil(this.aiCancel$))
      .subscribe({
        next: (res) => {
          this.aiBusy = false;
          if (res.aiResult.isUnreadable) {
            // Treat unreadable as a soft failure: still open empty so the
            // user can fill manually, but surface the model's reason.
            this.errorMessage = res.aiResult.warnings?.[0]
              || 'We could not read the part in that photo. Try a closer, well-lit shot.';
            this.openForm();
            return;
          }
          // FN-1365: parity with FN-1107 barcode flow — if the AI surfaced a
          // SKU that already exists in the catalog, open Edit on that record
          // instead of Create-prefilled. Any error along this lookup path
          // falls back to the existing Create-prefilled behavior.
          this.routePhotoResult(res.aiResult, res.r2Key);
        },
        error: (err: Error) => {
          this.aiBusy = false;
          this.errorMessage = err?.message || 'AI photo intake failed. Please fill the form manually.';
          // Failure path: open empty form so the user can still add the part.
          this.openForm();
        },
      });
  }

  /**
   * FN-1365: photo-intake routing. If the AI returned a partNumber that
   * matches an existing catalog SKU (case-insensitive), open the Edit modal
   * for that record. Otherwise open Create pre-filled. Lookup errors fall
   * through to Create pre-filled — never block the user from adding a part.
   */
  private routePhotoResult(
    ai: import('../../services/ai-parts.service').PartAiResult,
    r2Key: string,
  ): void {
    const skuUpper = (ai.partNumber || '').trim().toUpperCase();
    if (!skuUpper) {
      this.openFormPrefilled(ai, r2Key);
      return;
    }

    this.apiService.duplicateCheckParts({ sku: skuUpper, limit: 5 }).subscribe({
      next: (res: any) => {
        const candidates: Array<{ id: string; sku: string }> = Array.isArray(res?.data)
          ? res.data
          : [];
        const exact = candidates.find(
          (c) => (c?.sku || '').trim().toUpperCase() === skuUpper,
        );
        if (exact?.id) {
          // Resolve the full part record so the Edit modal has all fields
          // (manufacturer/vendor/uom/qty). Mirrors FN-1111's
          // onEditExistingDuplicate fallback pattern.
          this.apiService.getPartById(exact.id).subscribe({
            next: (full: any) => {
              const part = full?.data ?? full ?? exact;
              this.openForm(part);
            },
            error: () => {
              // Fall back to local cache, then to the candidate stub.
              const cached = this.parts.find((p: any) => p.id === exact.id);
              this.openForm(cached || exact);
            },
          });
          return;
        }
        this.openFormPrefilled(ai, r2Key);
      },
      error: () => {
        // Lookup transient/server error → still let the user add the part.
        this.openFormPrefilled(ai, r2Key);
      },
    });
  }

  cancelAiPhoto(): void {
    if (this.aiBusy) {
      this.aiCancel$.next();
      this.aiCancel$.complete();
      this.aiBusy = false;
    }
    this.aiPhotoSub?.unsubscribe();
    this.aiPhotoSub = null;
  }

  /**
   * Open the Add-Part modal pre-filled from the AI extraction. Manufacturer
   * is set as a typeahead "value" with id=null so the user must intentionally
   * pick an existing master record OR explicitly create a new one (FN-1091
   * binding). Creating a new master row never happens implicitly.
   */
  private openFormPrefilled(ai: import('../../services/ai-parts.service').PartAiResult, r2Key: string): void {
    this.openForm();
    this.aiR2Key = r2Key;
    this.aiWarnings = ai.warnings || [];

    const partNumber = ai.partNumber || '';
    const category = ai.category || '';
    const description = ai.descriptionGuess || '';

    this.partForm.patchValue({
      // SKU is the form's mapping for the AI partNumber suggestion (no
      // separate partNumber control). User can override.
      sku: partNumber,
      category: category,
      description: description,
    }, { emitEvent: false });

    if (ai.manufacturer) {
      // Show the AI suggestion in the typeahead, but with id=null so the user
      // must confirm by picking an existing record or explicitly creating one.
      this.manufacturerValue = { id: null, name: ai.manufacturer };
      this.partForm.patchValue({ manufacturer: ai.manufacturer, manufacturer_id: null }, { emitEvent: false });
    }

    // Snapshot the AI confidence so badges render. valueChanges listeners
    // will clear them as the user edits.
    this.aiConfidence = {
      manufacturer: ai.confidence?.manufacturer,
      partNumber:   ai.confidence?.partNumber,
      category:     ai.confidence?.category,
      description:  ai.confidence?.description,
      dimensions:   ai.confidence?.dimensions,
    };
  }

  // ── FN-1104: Quick Add → Scan Invoice ───────────────────────────────────────

  /** Trigger the hidden invoice file input (image or PDF). */
  startScanInvoice(): void {
    this.closeQuickAdd();
    if (!this.scanInvoiceInput?.nativeElement) return;
    // Reset so the same file can be reselected back-to-back.
    this.scanInvoiceInput.nativeElement.value = '';
    this.scanInvoiceInput.nativeElement.click();
  }

  /**
   * File-input handler. Uploads to /api/ai/parts/extract-from-invoice and
   * opens the review modal with the extracted lines. On failure, surface
   * a toast — the user can retry or fall back to manual add.
   */
  onScanInvoiceSelected(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    const file = target?.files?.[0];
    if (!file) return;

    this.errorMessage = '';
    this.successMessage = '';
    this.aiBusy = true;
    this.invoiceCancel$ = new Subject<void>();

    this.invoiceSub?.unsubscribe();
    this.invoiceSub = this.aiPartsService
      .extractFromInvoice(file)
      .pipe(takeUntil(this.invoiceCancel$))
      .subscribe({
        next: (res) => {
          this.aiBusy = false;
          this.invoiceAiResult = res.data;
          this.invoiceR2Key = res.r2Key || '';
          this.refreshInvoiceExistingSkus();
          this.invoiceModalOpen = true;
        },
        error: (err: Error) => {
          this.aiBusy = false;
          this.errorMessage = err?.message
            || 'AI invoice extraction failed. Please add parts manually.';
        },
      });
  }

  cancelAiInvoice(): void {
    if (this.aiBusy) {
      this.invoiceCancel$.next();
      this.invoiceCancel$.complete();
      this.aiBusy = false;
    }
    this.invoiceSub?.unsubscribe();
    this.invoiceSub = null;
  }

  /** Modal closed without confirming (Cancel or X). */
  onInvoiceModalClosed(): void {
    this.invoiceModalOpen = false;
    this.invoiceAiResult = null;
    this.invoiceR2Key = '';
  }

  /**
   * Modal confirmed bulk-create. Show a "Created N parts" toast and
   * refresh the catalog so the new SKUs appear immediately.
   */
  onInvoiceModalConfirmed(result: BulkCreateResponse): void {
    const createdCount = result?.created?.length || 0;
    const skippedCount = result?.skipped?.length || 0;

    if (createdCount > 0) {
      const noun = createdCount === 1 ? 'part' : 'parts';
      this.successMessage = skippedCount > 0
        ? `Created ${createdCount} ${noun} (${skippedCount} skipped). View catalog below.`
        : `Created ${createdCount} ${noun}. View catalog below.`;
      setTimeout(() => (this.successMessage = ''), 5000);
      this.loadParts();
    } else if (skippedCount > 0) {
      // Nothing created — leave the modal open so the user can fix per-row
      // errors (the modal renders them inline). No toast.
      return;
    }

    this.invoiceModalOpen = false;
    this.invoiceAiResult = null;
    this.invoiceR2Key = '';
  }

  // ── FN-1107: Quick Add → Scan Barcode ───────────────────────────────────────

  /** Open the shared scanner dialog from the Quick Add menu. */
  startScanBarcode(): void {
    this.closeQuickAdd();
    this.scannerError = null;
    this.scannerBusy = false;
    this.scannerOpen = true;
  }

  /** Close the scanner dialog and reset its transient state. */
  closeScanner(): void {
    this.scannerOpen = false;
    this.scannerError = null;
    this.scannerBusy = false;
  }

  /**
   * Dialog emitted a barcode value. Look it up; on match open Edit, on 404
   * open Add prefilled (read-only barcode), on other error keep the dialog
   * open with an inline error so the user can retry.
   */
  onBarcodeScanned(code: string): void {
    const value = (code || '').trim();
    if (!value) {
      this.scannerError = 'Empty barcode value.';
      return;
    }
    this.scannerError = null;
    this.scannerBusy = true;
    this.apiService.lookupBarcode(value).subscribe({
      next: (res: any) => {
        this.scannerBusy = false;
        const lookup = res?.data?.part;
        if (!lookup?.id) {
          // Endpoint returned 200 but no part — treat as unmatched.
          this.openAddWithBarcodePrefilled(value);
          return;
        }
        // Resolve the full part record from the local catalog cache so the
        // Edit modal sees manufacturer/vendor/uom/qty fields the lookup
        // endpoint doesn't return (FN-1107 acceptance note).
        const full = this.parts.find((p: any) => p.id === lookup.id) || lookup;
        this.scannerOpen = false;
        this.openForm(full);
      },
      error: (err: any) => {
        this.scannerBusy = false;
        if (err?.status === 404) {
          this.openAddWithBarcodePrefilled(value);
          return;
        }
        // Transient/server error — surface inside the dialog so the user can retry.
        this.scannerError = err?.error?.error || err?.message || 'Lookup failed. Try again.';
      },
    });
  }

  /** Open the Add Part modal with the scanned barcode prefilled and locked. */
  private openAddWithBarcodePrefilled(code: string): void {
    this.scannerOpen = false;
    this.openForm();
    this.partForm.patchValue({ barcode: code }, { emitEvent: false });
    this.barcodePrefilled = true;
  }
}
