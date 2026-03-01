/**
 * Customer Bulk Upload Module
 * Provides components and services for bulk uploading customers via Excel
 */

import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { CustomerBulkUploadComponent } from './customer-bulk-upload.component';

@NgModule({
  declarations: [
    CustomerBulkUploadComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    HttpClientModule
  ],
  exports: [
    CustomerBulkUploadComponent
  ]
})
export class CustomerBulkUploadModule { }
