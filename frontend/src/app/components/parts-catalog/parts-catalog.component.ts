import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';

@Component({
  selector: 'app-parts-catalog',
  templateUrl: './parts-catalog.component.html',
  styleUrls: ['./parts-catalog.component.css']
})
export class PartsCatalogComponent implements OnInit {
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

  constructor(private apiService: ApiService, private fb: FormBuilder) {
    this.partForm = this.fb.group({
      sku: ['', [Validators.required]],
      name: ['', Validators.required],
      category: ['', Validators.required],
      manufacturer: ['', Validators.required],
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
  }

  loadParts(filters?: any): void {
    this.loading = true;
    this.apiService.getParts(filters).subscribe({
      next: (response: any) => {
        this.parts = response.data || [];
        this.applyFilters();
        this.loading = false;
      },
      error: (error: any) => {
        this.errorMessage = `Failed to load parts: ${error.error?.error || error.message}`;
        this.loading = false;
      }
    });
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
    } else {
      this.editingPartId = null;
      this.partForm.reset();
    }
    this.showForm = true;
    this.successMessage = '';
    this.errorMessage = '';
  }

  openFormModal(part?: any): void {
    this.openForm(part);
  }

  closeForm(): void {
    this.showForm = false;
    this.editingPartId = null;
    this.partForm.reset();
  }

  savePart(): void {
    if (!this.partForm.valid) {
      this.errorMessage = 'Please fill in all required fields';
      return;
    }

    this.loading = true;
    const formData = this.partForm.value;

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
}
