import { NgModule, ErrorHandler } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule, HTTP_INTERCEPTORS } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { AppRoutingModule } from './app-routing.module';

import { AppComponent } from './app.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { DriversComponent } from './components/drivers/drivers.component';
import { DispatchDriversComponent } from './components/dispatch-drivers/dispatch-drivers.component';
import { VehiclesComponent } from './components/vehicles/vehicles.component';
import { VehicleFormComponent } from './components/vehicles/vehicle-form/vehicle-form.component';
import { HosComponent } from './components/hos/hos.component';
import { MaintenanceComponent } from './components/maintenance/maintenance.component';
import { WorkOrderComponent } from './components/work-order/work-order.component';
import { LoadsComponent } from './components/loads/loads.component';
import { LoadsDashboardComponent } from './components/loads-dashboard/loads-dashboard.component';
import { AuditComponent } from './components/audit/audit.component';
import { LoginComponent } from './components/login/login.component';
import { UserCreateComponent } from './components/user-create/user-create.component';
import { PartsCatalogComponent } from './components/parts-catalog/parts-catalog.component';
import { BarcodeManagementComponent } from './components/barcode-management/barcode-management.component';
import { WarehouseReceivingComponent } from './components/warehouse-receiving/warehouse-receiving.component';
import { InventoryTransfersComponent } from './components/inventory-transfers/inventory-transfers.component';
import { DirectSalesComponent } from './components/direct-sales/direct-sales.component';
import { InventoryReportsComponent } from './components/inventory-reports/inventory-reports.component';
import { StatusPillComponent } from './components/shared/status-pill/status-pill.component';
import { AttachmentChipComponent } from './components/shared/attachment-chip/attachment-chip.component';

// Dynatrace Error Handler
import { DynatraceErrorHandler } from './dynatrace-error-handler';
import { AuthInterceptor } from './auth.interceptor';
import { CacheBustingInterceptor } from './cache-busting.interceptor';

@NgModule({
  declarations: [
    AppComponent,
    DashboardComponent,
    DriversComponent,
    DispatchDriversComponent,
    VehiclesComponent,
    VehicleFormComponent,
    HosComponent,
    MaintenanceComponent,
    LoadsComponent,
    LoadsDashboardComponent,
    AuditComponent,
    LoginComponent,
    UserCreateComponent,
    WorkOrderComponent,
    PartsCatalogComponent,
    BarcodeManagementComponent,
    WarehouseReceivingComponent,
    InventoryTransfersComponent,
    DirectSalesComponent,
    InventoryReportsComponent,
    StatusPillComponent,
    AttachmentChipComponent
  ],
  imports: [
    BrowserModule,
    CommonModule,
    AppRoutingModule,
    HttpClientModule,
    FormsModule,
    ReactiveFormsModule
  ],
  providers: [
    // Enable Dynatrace error reporting
    // Uncomment to enable: { provide: ErrorHandler, useClass: DynatraceErrorHandler },
    {
      provide: HTTP_INTERCEPTORS,
      useClass: CacheBustingInterceptor,
      multi: true
    },
    {
      provide: HTTP_INTERCEPTORS,
      useClass: AuthInterceptor,
      multi: true
    }
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
