import { Component, OnInit } from '@angular/core';
import { CustomerService } from '../../services/customer.service';

interface UploadResult {
  successful: Array<{ row: number; company: string; id: string }>;
  failed: Array<{ row: number; company: string; errors: string[] }>;
  total: number;
}

@Component({
  selector: 'app-customer-bulk-upload',
  templateUrl: './customer-bulk-upload.component.html',
  styleUrls: ['./customer-bulk-upload.component.css']
})
export class CustomerBulkUploadComponent implements OnInit {
  selectedFile: File | null = null;
  uploading = false;
  uploadResults: UploadResult | null = null;
  successMessage = '';
  errorMessage = '';
  showResults = false;

  constructor(private customerService: CustomerService) {}

  ngOnInit(): void {}

  /**
   * Download the Excel template for bulk upload
   */
  downloadTemplate(): void {
    this.customerService.downloadUploadTemplate().subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'customer-upload-template.xlsx';
        link.click();
        window.URL.revokeObjectURL(url);
      },
      error: (error) => {
        this.errorMessage = 'Failed to download template';
        console.error(error);
      }
    });
  }

  /**
   * Handle file selection
   */
  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      const validTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
      if (!validTypes.includes(file.type)) {
        this.errorMessage = 'Please select a valid Excel file (.xlsx or .xls)';
        this.selectedFile = null;
        return;
      }
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        this.errorMessage = 'File size exceeds 5MB limit';
        this.selectedFile = null;
        return;
      }
      this.selectedFile = file;
      this.errorMessage = '';
      this.successMessage = '';
    }
  }

  /**
   * Upload the selected file
   */
  uploadFile(): void {
    if (!this.selectedFile) {
      this.errorMessage = 'Please select a file first';
      return;
    }

    this.uploading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.customerService.bulkUploadCustomers(this.selectedFile).subscribe({
      next: (response) => {
        this.uploading = false;
        this.uploadResults = response.results;
        this.showResults = true;
        
        const successCount = response.results.successful.length;
        const failCount = response.results.failed.length;
        
        if (failCount === 0) {
          this.successMessage = `✓ Successfully uploaded ${successCount} customers!`;
        } else {
          this.successMessage = `✓ Uploaded ${successCount} customers with ${failCount} failures (see details below)`;
        }
        
        this.selectedFile = null;
        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        if (fileInput) fileInput.value = '';
      },
      error: (error) => {
        this.uploading = false;
        this.errorMessage = error?.error?.error || 'Failed to upload file';
        console.error(error);
      }
    });
  }

  /**
   * Clear file selection
   */
  clearFile(): void {
    this.selectedFile = null;
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
  }

  /**
   * Close results dialog
   */
  closeResults(): void {
    this.showResults = false;
    this.uploadResults = null;
  }

  /**
   * Get summary stats
   */
  get successCount(): number {
    return this.uploadResults?.successful.length || 0;
  }

  get failureCount(): number {
    return this.uploadResults?.failed.length || 0;
  }

  get totalProcessed(): number {
    return this.uploadResults?.total || 0;
  }
}
