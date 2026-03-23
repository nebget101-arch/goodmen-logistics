import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { CustomerManagementRoutingModule } from './customer-management-routing.module';
import { CustomersListComponent } from './customers-list/customers-list.component';
import { CustomerFormComponent } from './customer-form/customer-form.component';
import { CustomerDetailComponent } from './customer-detail/customer-detail.component';
import { CustomerBulkUploadModule } from '../components/customer-bulk-upload/customer-bulk-upload.module';
import { SharedModule } from '../shared/shared.module';

@NgModule({
  declarations: [
    CustomersListComponent,
    CustomerFormComponent,
    CustomerDetailComponent
  ],
  imports: [
    CommonModule,
    HttpClientModule,
    FormsModule,
    ReactiveFormsModule,
    CustomerManagementRoutingModule,
    CustomerBulkUploadModule,
    SharedModule
  ]
})
export class CustomerManagementModule {}
