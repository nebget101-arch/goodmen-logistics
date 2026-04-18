import { ErrorHandler, Injectable, NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule, HTTP_INTERCEPTORS } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  handleError(error: any): void {
    console.error('[ANGULAR ERROR]', error?.message || error, error);
  }
}
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDialogModule } from '@angular/material/dialog';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { SharedModule } from './shared/shared.module';
import { AppRoutingModule } from './app-routing.module';

import { AppComponent } from './app.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { DriversComponent } from './components/drivers/drivers.component';
import { DispatchDriversComponent } from './components/dispatch-drivers/dispatch-drivers.component';
import { VehiclesComponent } from './components/vehicles/vehicles.component';
import { VehicleFormComponent } from './components/vehicles/vehicle-form/vehicle-form.component';
import { HosComponent } from './components/hos/hos.component';
// FN-770: MaintenanceComponent, WorkOrderComponent (+ tabs), LoadsDashboardComponent,
// and BarcodeManagementComponent are now declared in their own lazy-loaded feature
// modules (see app-routing.module.ts loadChildren entries).
import { SmartAutocompleteComponent } from './shared/components/smart-autocomplete/smart-autocomplete.component';
import { LoadsComponent } from './components/loads/loads.component';
import { DispatchBoardComponent } from './components/dispatch-board/dispatch-board.component';
import { AuditComponent } from './components/audit/audit.component';
import { LoginComponent } from './components/login/login.component';
import { ForgotPasswordComponent } from './components/forgot-password/forgot-password.component';
import { ResetPasswordComponent } from './components/reset-password/reset-password.component';
import { UserCreateComponent } from './components/user-create/user-create.component';
import { UsersAdminComponent } from './components/users-admin/users-admin.component';
import { ProfileComponent } from './components/profile/profile.component';
import { PartsCatalogComponent } from './components/parts-catalog/parts-catalog.component';
import { WarehouseReceivingComponent } from './components/warehouse-receiving/warehouse-receiving.component';
import { InventoryTransfersComponent } from './components/inventory-transfers/inventory-transfers.component';
import { DirectSalesComponent } from './components/direct-sales/direct-sales.component';
import { InventoryReportsComponent } from './components/inventory-reports/inventory-reports.component';
import { OnboardingPacketComponent } from './components/onboarding-packet/onboarding-packet.component';
import { PrivacyPolicyComponent } from './components/privacy-policy/privacy-policy.component';
import { TermsComponent } from './components/terms/terms.component';
import { CommunicationPreferencesComponent } from './components/communication-preferences/communication-preferences.component';
import { DatePickerComponent } from './components/shared/date-picker/date-picker.component';
import { MultiMcAdminComponent } from './components/multi-mc-admin/multi-mc-admin.component';
import { TrialRequestsAdminComponent } from './components/trial-requests-admin/trial-requests-admin.component';
import { EmploymentApplicationComponent } from './onboarding/employment-application/employment-application.component';
import { RoadsideBoardComponent } from './components/roadside-board/roadside-board.component';
import { PublicRoadsideComponent } from './components/public-roadside/public-roadside.component';
import { EmployerResponseComponent } from './public/components/employer-response/employer-response.component';
import { RoadsideAiCallerComponent } from './components/roadside-ai-caller/roadside-ai-caller.component';
import { PaymentMethodFormComponent } from './billing/payment-method-form/payment-method-form.component';
import { TrialBannerComponent } from './shared/trial-banner/trial-banner.component';
import { BillingComponent } from './billing/billing.component';
import { AuthInterceptor } from './auth.interceptor';
import { CacheBustingInterceptor } from './cache-busting.interceptor';
// FN-771: HasPermissionDirective + HasAnyPermissionDirective moved into SharedModule
// so they're available in lazy-loaded feature modules (e.g. LoadsDashboardModule).
import { DriverComplianceSectionComponent } from './components/drivers/driver-compliance-section/driver-compliance-section.component';
import { PreEmploymentGateComponent } from './components/drivers/pre-employment-gate/pre-employment-gate.component';
import { InvestigationPanelComponent } from './components/drivers/investigation-panel/investigation-panel.component';
import { RecordResponseModalComponent } from './components/drivers/investigation-panel/record-response-modal/record-response-modal.component';
import { InvestigationHistoryComponent } from './components/drivers/investigation-history/investigation-history.component';
import { ConsentFormComponent } from './components/onboarding-packet/consent-form/consent-form.component';
import { EmployerHistoryTieredComponent } from './components/onboarding-packet/employer-history-tiered/employer-history-tiered.component';
import { DisqualificationHistoryComponent } from './components/onboarding-packet/disqualification-history/disqualification-history.component';
import { IdleTruckAlertsComponent } from './components/idle-truck-alerts/idle-truck-alerts.component';
import { LocationsAdminModule } from './components/locations-admin/locations-admin.module';
// FN-770: LoadWizardModule, StepStopsComponent, WizardStepDriverComponent,
// StepAttachmentsComponent moved into LoadsDashboardModule (lazy-loaded).
import { InventoryItemEditDialogComponent } from './components/inventory/inventory-item-edit-dialog/inventory-item-edit-dialog.component';
import { AutoReplenishmentComponent } from './components/auto-replenishment/auto-replenishment.component';

@NgModule({
  declarations: [
    AppComponent,
    DashboardComponent,
    DriversComponent,
    DispatchDriversComponent,
    VehiclesComponent,
    VehicleFormComponent,
    HosComponent,
    LoadsComponent,
    DispatchBoardComponent,
    AuditComponent,
    LoginComponent,
    ForgotPasswordComponent,
    ResetPasswordComponent,
    UsersAdminComponent,
    UserCreateComponent,
    ProfileComponent,
    SmartAutocompleteComponent,
    PartsCatalogComponent,
    WarehouseReceivingComponent,
    InventoryTransfersComponent,
    DirectSalesComponent,
    InventoryReportsComponent,
    OnboardingPacketComponent,
    PrivacyPolicyComponent,
    TermsComponent,
    CommunicationPreferencesComponent,
    DatePickerComponent,
    MultiMcAdminComponent
    ,TrialRequestsAdminComponent
    ,EmploymentApplicationComponent,
    RoadsideBoardComponent,
    PublicRoadsideComponent,
    EmployerResponseComponent,
    RoadsideAiCallerComponent,
    PaymentMethodFormComponent,
    TrialBannerComponent,
    BillingComponent,
    DriverComplianceSectionComponent,
    PreEmploymentGateComponent,
    InvestigationPanelComponent,
    RecordResponseModalComponent,
    InvestigationHistoryComponent,
    ConsentFormComponent,
    EmployerHistoryTieredComponent,
    DisqualificationHistoryComponent,
    IdleTruckAlertsComponent,
    InventoryItemEditDialogComponent,
    AutoReplenishmentComponent
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
    MatDialogModule,
    DragDropModule,
    SharedModule,
    LocationsAdminModule
  ],
  providers: [
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
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
