import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { CustomerManagementRoutingModule } from './customer-management-routing.module';
import { CustomersListComponent } from './customers-list/customers-list.component';
import { CustomerFormComponent } from './customer-form/customer-form.component';
import { CustomerDetailComponent } from './customer-detail/customer-detail.component';
import { CustomerBulkUploadComponent } from '../components/customer-bulk-upload/customer-bulk-upload.component';

@NgModule({
  declarations: [
    CustomersListComponent,
    CustomerFormComponent,
    CustomerDetailComponent,
    CustomerBulkUploadComponent
  ],
  imports: [
    CommonModule,
    HttpClientModule,
    FormsModule,
    ReactiveFormsModule,
    CustomerManagementRoutingModule
  ]
})
export class CustomerManagementModule {}
