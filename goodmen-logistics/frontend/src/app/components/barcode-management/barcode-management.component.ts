import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-barcode-management',
  templateUrl: './barcode-management.component.html',
  styleUrls: ['./barcode-management.component.css']
})
export class BarcodeManagementComponent implements OnInit {
  parts: any[] = [];
  filteredParts: any[] = [];
  selectedPartId = '';
  selectedPart: any = null;
  barcodes: any[] = [];

  search = '';
  barcodeValue = '';
  packQty = 1;
  vendor = '';

  loading = false;
  message = '';
  error = '';

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.loadParts();
  }

  loadParts(): void {
    this.loading = true;
    this.api.getParts({ search: this.search }).subscribe({
      next: (res: any) => {
        this.parts = res?.data || [];
        this.filteredParts = [...this.parts];
        this.loading = false;
      },
      error: (err: any) => {
        this.error = err?.error?.error || err?.message || 'Failed to load parts';
        this.loading = false;
      }
    });
  }

  onSearchChange(): void {
    const q = this.search.trim().toLowerCase();
    this.filteredParts = this.parts.filter(p =>
      (p.sku || '').toLowerCase().includes(q) ||
      (p.name || '').toLowerCase().includes(q)
    );
  }

  onSelectPart(partId: string): void {
    this.selectedPartId = partId;
    this.selectedPart = this.parts.find(p => p.id === partId) || null;
    this.barcodes = [];
    this.clearMessages();
    if (!partId) return;

    this.api.getPartBarcodes(partId).subscribe({
      next: (res: any) => {
        this.barcodes = res?.data || [];
      },
      error: (err: any) => {
        this.error = err?.error?.error || err?.message || 'Failed to load barcodes';
      }
    });
  }

  assignBarcode(): void {
    this.clearMessages();
    if (!this.selectedPartId) {
      this.error = 'Select a part first';
      return;
    }
    if (!this.barcodeValue.trim()) {
      this.error = 'Barcode value is required';
      return;
    }

    this.api.assignPartBarcode(this.selectedPartId, {
      barcodeValue: this.barcodeValue.trim(),
      packQty: this.packQty,
      vendor: this.vendor || undefined
    }).subscribe({
      next: () => {
        this.message = 'Barcode assigned';
        this.barcodeValue = '';
        this.packQty = 1;
        this.vendor = '';
        this.onSelectPart(this.selectedPartId);
      },
      error: (err: any) => {
        this.error = err?.error?.error || err?.message || 'Failed to assign barcode';
      }
    });
  }

  private clearMessages(): void {
    this.message = '';
    this.error = '';
  }
}
