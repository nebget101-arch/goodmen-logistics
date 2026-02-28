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
    this.userRole = localStorage.getItem('role');
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
}
