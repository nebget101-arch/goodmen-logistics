import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
} from '@angular/core';
import { Observable, of } from 'rxjs';

import {
  AiPartsService,
  BulkCreateResponse,
  BulkPartItem,
  BulkPartSkipped,
  InvoiceAiResult,
  InvoiceLineItem,
} from '../../../services/ai-parts.service';
import { ManufacturersService, MasterEntity } from '../../../services/manufacturers.service';
import { VendorsService } from '../../../services/vendors.service';
import { MasterTypeaheadValue } from '../../shared/master-typeahead/master-typeahead.component';

/**
 * FN-1104: Quick Add Part — Scan Invoice review modal.
 *
 * Renders the AI extraction (vendor, invoice #, line items) for the user
 * to review/edit/check, then calls `POST /api/parts/bulk` with the selected
 * lines. SKUs that already exist in the catalog are pre-flagged with a
 * `skip` indicator and unchecked by default — the parent passes the set
 * of catalog SKUs in via `existingSkus`.
 *
 * The modal emits `confirmed` with the BE bulk-create result so the parent
 * can show a "Created N parts" toast and refresh the list. On error the
 * modal stays open so the user can retry.
 */
@Component({
  selector: 'app-quick-add-invoice-modal',
  templateUrl: './quick-add-invoice-modal.component.html',
  styleUrls: ['./quick-add-invoice-modal.component.css'],
})
export class QuickAddInvoiceModalComponent implements OnInit, OnChanges {
  /** AI extraction from `extractFromInvoice`. Required. */
  @Input() aiResult: InvoiceAiResult | null = null;

  /** R2 key the BE returned for the uploaded invoice — held for audit. */
  @Input() r2Key = '';

  /**
   * SKUs (case-insensitive uppercase) that already exist in the parts
   * catalog. Lines whose SKU matches will be flagged "Already in catalog"
   * and unchecked by default.
   */
  @Input() existingSkus: Set<string> = new Set<string>();

  /**
   * FN-1472: Category suggestions sourced from the parent's catalog list
   * (`GET /api/parts/categories`). Wired through a `<datalist>` so the
   * per-row Category cell behaves as an editable dropdown — same set the
   * manual Add Part form filters by, but the user can still type a brand
   * new category if the AI surfaced one we haven't seen.
   */
  @Input() categories: string[] = [];

  @Output() confirmed = new EventEmitter<BulkCreateResponse>();
  @Output() closed = new EventEmitter<void>();

  vendor = '';
  vendorValue: MasterTypeaheadValue | null = null;
  vendorConfidence: number | null = null;

  invoiceNumber = '';
  invoiceNumberConfidence: number | null = null;

  warnings: string[] = [];

  rows: ReviewRow[] = [];

  saving = false;
  errorMessage = '';

  /**
   * Per-row error from the bulk endpoint, keyed by uppercase SKU.
   * Populated after a partial success (e.g. `sku_exists`,
   * `missing_sku_or_name`).
   */
  rowErrors: Record<string, string> = {};

  /** True after a successful bulk-create — drives the success summary. */
  resultSummary: BulkCreateResponse | null = null;

  /**
   * Bound once at construction so the OnPush master-typeahead receives
   * stable Input references (FN-317 RCA). The vendor and per-row
   * manufacturer typeaheads share the same searchFn/createFn instances.
   */
  readonly searchVendors = (q: string): Observable<MasterEntity[]> =>
    this.vendorsService.search(q);
  readonly createVendor = (name: string): Observable<MasterEntity> =>
    this.vendorsService.create(name);
  readonly searchManufacturers = (q: string): Observable<MasterEntity[]> =>
    this.manufacturersService ? this.manufacturersService.search(q) : of([]);
  readonly createManufacturer = (name: string): Observable<MasterEntity> =>
    this.manufacturersService.create(name);

  constructor(
    private readonly aiPartsService: AiPartsService,
    private readonly manufacturersService: ManufacturersService,
    private readonly vendorsService: VendorsService,
  ) {}

  ngOnInit(): void {
    this.hydrate();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['aiResult'] || changes['existingSkus']) {
      this.hydrate();
    }
  }

  private hydrate(): void {
    const ai = this.aiResult;
    this.vendor = ai?.vendor || '';
    this.vendorValue = this.vendor ? { id: null, name: this.vendor } : null;
    this.vendorConfidence = numberOrNull(ai?.confidence?.vendor);
    this.invoiceNumber = ai?.invoiceNumber || '';
    this.invoiceNumberConfidence = numberOrNull(ai?.confidence?.invoiceNumber);
    this.warnings = ai?.warnings || [];
    this.rows = (ai?.lineItems || []).map((line) => this.toReviewRow(line));
    this.errorMessage = '';
    this.rowErrors = {};
    this.resultSummary = null;
  }

  private toReviewRow(line: InvoiceLineItem): ReviewRow {
    const skuKey = (line.sku || '').trim().toUpperCase();
    const alreadyExists = !!skuKey && this.existingSkus.has(skuKey);
    return {
      sku: line.sku || '',
      description: line.description || '',
      // FN-1472/FN-1473: prefill category from the AI extraction. The user
      // can still override before save; the AI confidence badge surfaces
      // alongside the field until the user edits it.
      category: line.category || '',
      qty: line.qty,
      unitCost: line.unitCost,
      manufacturer: line.manufacturer || '',
      manufacturerValue: line.manufacturer
        ? { id: null, name: line.manufacturer }
        : null,
      confidence: line.confidence || {},
      selected: !alreadyExists,
      alreadyExists,
    };
  }

  // ── Vendor + invoice number editing ──────────────────────────────────────

  onVendorPick(value: MasterTypeaheadValue): void {
    this.vendorValue = value;
    this.vendor = value.name;
    // User confirmed/typed → AI badge no longer authoritative.
    this.vendorConfidence = null;
  }

  onInvoiceNumberInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.invoiceNumber = target?.value ?? '';
    this.invoiceNumberConfidence = null;
  }

  // ── Per-row editing ──────────────────────────────────────────────────────

  toggleRow(row: ReviewRow): void {
    row.selected = !row.selected;
  }

  onRowFieldInput(
    row: ReviewRow,
    field: 'sku' | 'description' | 'category',
    event: Event,
  ): void {
    const target = event.target as HTMLInputElement | null;
    row[field] = target?.value ?? '';
    if (field === 'sku' || field === 'description' || field === 'category') {
      row.confidence = { ...row.confidence, [field]: undefined };
    }
    if (field === 'sku') {
      // Re-evaluate the catalog-collision flag — the user may have edited
      // away from a duplicate, or vice-versa.
      const skuKey = (row.sku || '').trim().toUpperCase();
      row.alreadyExists = !!skuKey && this.existingSkus.has(skuKey);
    }
  }

  onRowNumberInput(row: ReviewRow, field: 'qty' | 'unitCost', event: Event): void {
    const target = event.target as HTMLInputElement | null;
    const raw = target?.value ?? '';
    const parsed = parseFloat(raw);
    row[field] = Number.isFinite(parsed) ? parsed : 0;
    row.confidence = { ...row.confidence, [field]: undefined };
  }

  onRowManufacturerPick(row: ReviewRow, value: MasterTypeaheadValue): void {
    row.manufacturerValue = value;
    row.manufacturer = value.name;
    row.confidence = { ...row.confidence, manufacturer: undefined };
  }

  // ── Selection helpers ────────────────────────────────────────────────────

  get selectedCount(): number {
    return this.rows.filter((r) => r.selected).length;
  }

  get canConfirm(): boolean {
    return !this.saving && this.selectedCount > 0;
  }

  selectAll(): void {
    this.rows.forEach((r) => (r.selected = true));
  }

  deselectAll(): void {
    this.rows.forEach((r) => (r.selected = false));
  }

  // ── Confirm + cancel ─────────────────────────────────────────────────────

  confirm(): void {
    if (!this.canConfirm) return;

    const items = this.buildBulkItems();
    if (items.length === 0) {
      this.errorMessage = 'No selected lines have a SKU and description.';
      return;
    }

    this.saving = true;
    this.errorMessage = '';
    this.rowErrors = {};

    this.aiPartsService.bulkCreate(items).subscribe({
      next: (res) => {
        this.saving = false;
        this.resultSummary = res;
        // Surface per-row reasons inline so the user can see exactly which
        // SKUs were rejected and why (e.g. already in catalog).
        for (const skip of res.skipped || []) {
          if (skip?.sku) {
            this.rowErrors[skip.sku.toUpperCase()] = this.skipReasonLabel(skip);
          }
        }
        this.confirmed.emit(res);
      },
      error: (err: Error) => {
        this.saving = false;
        this.errorMessage = err?.message
          || 'Bulk-create failed. Some parts may not have been saved.';
      },
    });
  }

  cancel(): void {
    if (this.saving) return;
    this.closed.emit();
  }

  private buildBulkItems(): BulkPartItem[] {
    return this.rows
      .filter((r) => r.selected)
      .map((r) => {
        const sku = (r.sku || '').trim();
        const description = (r.description || '').trim();
        const category = (r.category || '').trim();
        // BE requires `name`; we map description → name (fallback to SKU
        // so we never send an empty name when the user keeps a description-
        // less line). The BE rejects missing-sku/name with a clean
        // `skipped[].reason = 'missing_sku_or_name'` we surface inline.
        const name = description || sku;
        return {
          sku,
          name,
          description,
          // FN-1365: optional per-row category. Omit when blank so the BE
          // tolerate-null path (FN-1364) and DB-nullable column (FN-1363)
          // accept the row without a category.
          category: category || undefined,
          manufacturer: (r.manufacturer || '').trim() || undefined,
          preferred_vendor_name: (this.vendor || '').trim() || undefined,
          unit_cost: r.unitCost,
        };
      })
      .filter((item) => item.sku.length > 0);
  }

  trackByIndex(index: number, _row: ReviewRow): number {
    return index;
  }

  private skipReasonLabel(skip: BulkPartSkipped): string {
    switch (skip.reason) {
      case 'duplicate_in_request':
        return 'Skipped — duplicate SKU in this batch.';
      case 'sku_exists':
        return 'Already in catalog — skipped.';
      case 'missing_sku_or_name':
        return 'Missing SKU or description.';
      default:
        return `Skipped — ${skip.reason}`;
    }
  }
}

interface ReviewRow {
  sku: string;
  description: string;
  /** FN-1365: optional per-row category — sent on bulk-create when non-empty. */
  category: string;
  qty: number;
  unitCost: number;
  manufacturer: string;
  manufacturerValue: MasterTypeaheadValue | null;
  confidence: {
    sku?: number;
    description?: number;
    qty?: number;
    unitCost?: number;
    manufacturer?: number;
    category?: number;
  };
  selected: boolean;
  alreadyExists: boolean;
}

function numberOrNull(n: number | undefined | null): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}
