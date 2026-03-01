/**
 * INTEGRATION EXAMPLE
 * Shows how to integrate the bulk upload component into your app
 */

// ============================================
// OPTION 1: Add to App Module (Recommended)
// ============================================

// app.module.ts

import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';

import { AppComponent } from './app.component';

// Import the bulk upload module
import { CustomerBulkUploadModule } from './components/customer-bulk-upload/customer-bulk-upload.module';

@NgModule({
  declarations: [
    AppComponent,
    // ... other components
  ],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    HttpClientModule,
    FormsModule,
    // Add bulk upload module
    CustomerBulkUploadModule  // ← Add this line
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }


// ============================================
// OPTION 2: Add to Customers Component
// ============================================

// customers/customers.component.ts

import { Component, OnInit } from '@angular/core';
import { CustomerService } from '../../services/customer.service';

@Component({
  selector: 'app-customers',
  templateUrl: './customers.component.html',
  styleUrls: ['./customers.component.css']
})
export class CustomersComponent implements OnInit {
  showBulkUpload = false;
  customers: any[] = [];

  constructor(private customerService: CustomerService) {}

  ngOnInit(): void {
    this.loadCustomers();
  }

  loadCustomers(): void {
    this.customerService.listCustomers({ pageSize: 100 }).subscribe({
      next: (res) => {
        this.customers = res.data || [];
      }
    });
  }

  toggleBulkUpload(): void {
    this.showBulkUpload = !this.showBulkUpload;
  }

  onBulkUploadSuccess(): void {
    // Reload customers after successful upload
    this.loadCustomers();
    this.showBulkUpload = false;
  }
}

// customers/customers.component.html

<div class="customers-container">
  <div class="header">
    <h2>Customer Management</h2>
    <button (click)="toggleBulkUpload()" class="btn btn-primary">
      📥 Bulk Import
    </button>
  </div>

  <!-- Bulk Upload Section -->
  <div *ngIf="showBulkUpload" class="bulk-upload-section">
    <button (click)="toggleBulkUpload()" class="close-btn">✕</button>
    <app-customer-bulk-upload 
      (uploadSuccess)="onBulkUploadSuccess()">
    </app-customer-bulk-upload>
  </div>

  <!-- Customers List -->
  <div class="customers-list">
    <h3>All Customers</h3>
    <!-- Your existing customer list code -->
  </div>
</div>


// ============================================
// OPTION 3: Add to Dashboard
// ============================================

// dashboard/dashboard.component.html

<div class="dashboard">
  <div class="dashboard-grid">
    <!-- Existing widgets -->
    
    <!-- Bulk Upload Widget -->
    <div class="widget bulk-upload-widget">
      <h4>Quick Actions</h4>
      <button class="btn" (click)="downloadTemplate()">
        📥 Download Customer Template
      </button>
      <button class="btn" (click)="showUploadModal = true">
        📤 Upload Customers
      </button>
    </div>
  </div>

  <!-- Upload Modal -->
  <div *ngIf="showUploadModal" class="modal">
    <app-customer-bulk-upload></app-customer-bulk-upload>
  </div>
</div>


// ============================================
// OPTION 4: Standalone Service Usage
// ============================================

// my-service.ts

import { Injectable } from '@angular/core';
import { CustomerService } from './customer.service';

@Injectable({
  providedIn: 'root'
})
export class ImportService {
  constructor(private customerService: CustomerService) {}

  /**
   * Download the bulk upload template
   */
  downloadTemplate(): void {
    this.customerService.downloadUploadTemplate().subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'customer-template.xlsx';
        link.click();
        window.URL.revokeObjectURL(url);
      },
      error: (error) => {
        console.error('Template download failed:', error);
      }
    });
  }

  /**
   * Upload customers from Excel file
   */
  uploadCustomersFromFile(file: File): Promise<any> {
    return new Promise((resolve, reject) => {
      this.customerService.bulkUploadCustomers(file).subscribe({
        next: (result) => {
          console.log('Upload successful:', result);
          resolve(result);
        },
        error: (error) => {
          console.error('Upload failed:', error);
          reject(error);
        }
      });
    });
  }

  /**
   * Handle file selection
   */
  onFileSelected(event: any): File | null {
    const file = event.target.files[0];
    if (!file) return null;

    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ];

    if (!validTypes.includes(file.type)) {
      console.error('Invalid file type');
      return null;
    }

    if (file.size > 5 * 1024 * 1024) {
      console.error('File too large (max 5MB)');
      return null;
    }

    return file;
  }
}


// ============================================
// OPTION 5: Advanced - Custom Modal
// ============================================

// import the component
import { Component } from '@angular/core';
import { CustomerBulkUploadComponent } from './components/customer-bulk-upload/customer-bulk-upload.component';

@Component({
  selector: 'app-import-dialog',
  template: `
    <div class="import-dialog" *ngIf="isOpen">
      <div class="dialog-overlay" (click)="close()"></div>
      <div class="dialog-content">
        <div class="dialog-header">
          <h3>Import Customers</h3>
          <button (click)="close()">✕</button>
        </div>
        <app-customer-bulk-upload 
          #bulkUpload>
        </app-customer-bulk-upload>
      </div>
    </div>
  `,
  styles: [`
    .import-dialog {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    
    .dialog-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
    }
    
    .dialog-content {
      position: relative;
      background: white;
      border-radius: 8px;
      max-width: 600px;
      max-height: 80vh;
      overflow-y: auto;
    }
    
    .dialog-header {
      padding: 20px;
      border-bottom: 1px solid #e0e0e0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
  `]
})
export class ImportDialogComponent {
  isOpen = false;

  open(): void {
    this.isOpen = true;
  }

  close(): void {
    this.isOpen = false;
  }
}


// ============================================
// TESTING EXAMPLE
// ============================================

// customer-bulk-upload.component.spec.ts

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { CustomerBulkUploadComponent } from './customer-bulk-upload.component';
import { CustomerService } from '../../services/customer.service';

describe('CustomerBulkUploadComponent', () => {
  let component: CustomerBulkUploadComponent;
  let fixture: ComponentFixture<CustomerBulkUploadComponent>;
  let customerService: jasmine.SpyObj<CustomerService>;

  beforeEach(async () => {
    const spy = jasmine.createSpyObj('CustomerService', [
      'downloadUploadTemplate',
      'bulkUploadCustomers'
    ]);

    await TestBed.configureTestingModule({
      declarations: [ CustomerBulkUploadComponent ],
      imports: [ HttpClientTestingModule ],
      providers: [ { provide: CustomerService, useValue: spy } ]
    })
    .compileComponents();

    customerService = TestBed.inject(CustomerService) as jasmine.SpyObj<CustomerService>;
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(CustomerBulkUploadComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should download template', () => {
    const mockBlob = new Blob(['test']);
    customerService.downloadUploadTemplate.and.returnValue(
      of(mockBlob)
    );

    component.downloadTemplate();
    
    expect(customerService.downloadUploadTemplate).toHaveBeenCalled();
  });

  it('should validate file selection', () => {
    const validFile = new File(['test'], 'test.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    const event = { target: { files: [validFile] } };
    component.onFileSelected(event);

    expect(component.selectedFile).toBe(validFile);
    expect(component.errorMessage).toBe('');
  });

  it('should reject invalid file types', () => {
    const invalidFile = new File(['test'], 'test.txt', {
      type: 'text/plain'
    });

    const event = { target: { files: [invalidFile] } };
    component.onFileSelected(event);

    expect(component.selectedFile).toBeNull();
    expect(component.errorMessage).toContain('Excel');
  });
});


// ============================================
// EXAMPLE: In app.component.html
// ============================================

<div class="app-container">
  <nav>
    <a routerLink="/customers">Customers</a>
    <a routerLink="/bulk-import">Bulk Import</a>
  </nav>

  <main>
    <router-outlet></router-outlet>
  </main>
</div>


// ============================================
// EXAMPLE: Dedicated Bulk Import Route
// ============================================

// app-routing.module.ts

import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CustomerBulkUploadComponent } from './components/customer-bulk-upload/customer-bulk-upload.component';

const routes: Routes = [
  {
    path: 'bulk-import',
    component: CustomerBulkUploadComponent,
    data: { title: 'Bulk Import Customers' }
  },
  // ... other routes
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }


// ============================================
// RECOMMENDED: Customers Module
// ============================================

// customers/customers.module.ts

import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';

import { CustomersComponent } from './customers.component';
import { CustomerBulkUploadModule } from '../customer-bulk-upload/customer-bulk-upload.module';

@NgModule({
  declarations: [
    CustomersComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    HttpClientModule,
    CustomerBulkUploadModule  // ← Include here
  ]
})
export class CustomersModule { }
