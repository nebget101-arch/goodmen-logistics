import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule, HTTP_INTERCEPTORS } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDialogModule } from '@angular/material/dialog';
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
import { DispatchBoardComponent } from './components/dispatch-board/dispatch-board.component';
import { AuditComponent } from './components/audit/audit.component';
import { LoginComponent } from './components/login/login.component';
import { ForgotPasswordComponent } from './components/forgot-password/forgot-password.component';
import { ResetPasswordComponent } from './components/reset-password/reset-password.component';
import { UserCreateComponent } from './components/user-create/user-create.component';
import { UsersAdminComponent } from './components/users-admin/users-admin.component';
import { ProfileComponent } from './components/profile/profile.component';
import { PartsCatalogComponent } from './components/parts-catalog/parts-catalog.component';
import { BarcodeManagementComponent } from './components/barcode-management/barcode-management.component';
import { WarehouseReceivingComponent } from './components/warehouse-receiving/warehouse-receiving.component';
import { InventoryTransfersComponent } from './components/inventory-transfers/inventory-transfers.component';
import { DirectSalesComponent } from './components/direct-sales/direct-sales.component';
import { InventoryReportsComponent } from './components/inventory-reports/inventory-reports.component';
import { StatusPillComponent } from './components/shared/status-pill/status-pill.component';
import { AttachmentChipComponent } from './components/shared/attachment-chip/attachment-chip.component';
import { OnboardingPacketComponent } from './components/onboarding-packet/onboarding-packet.component';
import { PrivacyPolicyComponent } from './components/privacy-policy/privacy-policy.component';
import { TermsComponent } from './components/terms/terms.component';
import { CommunicationPreferencesComponent } from './components/communication-preferences/communication-preferences.component';
import { DatePickerComponent } from './components/shared/date-picker/date-picker.component';
import { InlineDateFilterComponent } from './components/shared/inline-date-filter/inline-date-filter.component';
import { MultiMcAdminComponent } from './components/multi-mc-admin/multi-mc-admin.component';
import { TrialRequestsAdminComponent } from './components/trial-requests-admin/trial-requests-admin.component';
import { EmploymentApplicationComponent } from './onboarding/employment-application/employment-application.component';
import { RoadsideBoardComponent } from './components/roadside-board/roadside-board.component';
import { PublicRoadsideComponent } from './components/public-roadside/public-roadside.component';
import { RoadsideAiCallerComponent } from './components/roadside-ai-caller/roadside-ai-caller.component';
import { PaymentMethodFormComponent } from './billing/payment-method-form/payment-method-form.component';
import { TrialBannerComponent } from './shared/trial-banner/trial-banner.component';
import { BillingComponent } from './billing/billing.component';
import { AiDatePickerComponent } from './shared/ai-date-picker/ai-date-picker.component';

import { AuthInterceptor } from './auth.interceptor';
import { CacheBustingInterceptor } from './cache-busting.interceptor';
import { HasPermissionDirective, HasAnyPermissionDirective } from './directives/has-permission.directive';

@NgModule({
  declarations: [
    AppComponent,
    HasPermissionDirective,
    HasAnyPermissionDirective,
    DashboardComponent,
    DriversComponent,
    DispatchDriversComponent,
    VehiclesComponent,
    VehicleFormComponent,
    HosComponent,
    MaintenanceComponent,
    LoadsComponent,
    LoadsDashboardComponent,
    DispatchBoardComponent,
    AuditComponent,
    LoginComponent,
    ForgotPasswordComponent,
    ResetPasswordComponent,
    UsersAdminComponent,
    UserCreateComponent,
    ProfileComponent,
    WorkOrderComponent,
    PartsCatalogComponent,
    BarcodeManagementComponent,
    WarehouseReceivingComponent,
    InventoryTransfersComponent,
    DirectSalesComponent,
    InventoryReportsComponent,
    StatusPillComponent,
    AttachmentChipComponent,
    OnboardingPacketComponent,
    PrivacyPolicyComponent,
    TermsComponent,
    CommunicationPreferencesComponent,
    DatePickerComponent,
    InlineDateFilterComponent,
    MultiMcAdminComponent
    ,TrialRequestsAdminComponent
    ,EmploymentApplicationComponent,
    RoadsideBoardComponent,
    PublicRoadsideComponent,
    RoadsideAiCallerComponent,
    PaymentMethodFormComponent,
    TrialBannerComponent,
    BillingComponent,
    AiDatePickerComponent
  ],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    CommonModule,
    AppRoutingModule,
    HttpClientModule,
    FormsModule,
    ReactiveFormsModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatFormFieldModule,
    MatInputModule,
    MatDialogModule
  ],
  providers: [
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
