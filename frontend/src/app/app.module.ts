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
import { DriverEditComponent } from './components/driver-edit/driver-edit.component';
import { VehiclesComponent } from './components/vehicles/vehicles.component';
import { VehicleFormComponent } from './components/vehicles/vehicle-form/vehicle-form.component';
import { HosComponent } from './components/hos/hos.component';
// FN-770: MaintenanceComponent, WorkOrderComponent (+ tabs), LoadsDashboardComponent,
// and BarcodeManagementComponent are now declared in their own lazy-loaded feature
// modules (see app-routing.module.ts loadChildren entries).
import { SmartAutocompleteComponent } from './shared/components/smart-autocomplete/smart-autocomplete.component';
// FN-1636 — dev-only primitives showcase (route gated by !environment.production)
import { DashboardPrimitivesComponent } from './dev/dashboard-primitives/dashboard-primitives.component';
// FN-1644 — dev-only Roadside primitives sandbox (route gated by !environment.production)
import { RoadsidePrimitivesComponent } from './components/dev/roadside-primitives/roadside-primitives.component';
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
import { QuickAddInvoiceModalComponent } from './components/parts-catalog/quick-add-invoice-modal/quick-add-invoice-modal.component';
import { DuplicateWarningComponent } from './components/parts-catalog/duplicate-warning/duplicate-warning.component';
import { PartLabelPrintComponent } from './components/part-label-print/part-label-print.component';
import { MasterTypeaheadComponent } from './components/shared/master-typeahead/master-typeahead.component';
import { ConfidenceBadgeComponent } from './components/shared/confidence-badge/confidence-badge.component';
import { BarcodeScannerDialogComponent } from './components/shared/barcode-scanner-dialog/barcode-scanner-dialog.component';
// FN-1549: WarehouseReceivingComponent + 5 children moved into
// WarehouseReceivingModule (lazy-loaded at /receiving).
import { InventoryTransfersComponent } from './components/inventory-transfers/inventory-transfers.component';
import { DirectSalesComponent } from './components/direct-sales/direct-sales.component';
import { InventoryReportsComponent } from './components/inventory-reports/inventory-reports.component';
// FN-1549: OnboardingPacketComponent + 3 children moved into
// OnboardingPacketModule (lazy-loaded at /onboard/:packetId).
import { PrivacyPolicyComponent } from './components/privacy-policy/privacy-policy.component';
import { TermsComponent } from './components/terms/terms.component';
import { CommunicationPreferencesComponent } from './components/communication-preferences/communication-preferences.component';
import { DatePickerComponent } from './components/shared/date-picker/date-picker.component';
import { MultiMcAdminComponent } from './components/multi-mc-admin/multi-mc-admin.component';
// FN-1549: TrialRequestsAdminComponent moved into TrialRequestsAdminModule
// (lazy-loaded at /admin/trial-requests).
import { InboundEmailSettingsComponent } from './components/admin/inbound-email-settings/inbound-email-settings.component';
// FN-1549: FmcsaImportsAdminComponent moved into FmcsaImportsAdminModule
// (lazy-loaded at /admin/fmcsa-imports).
// FN-1549: EmploymentApplicationComponent moved into EmploymentApplicationModule
// (lazy-loaded at /employment-application).
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
// FN-1549: ConsentForm/EmployerHistoryTiered/DisqualificationHistory now live
// in OnboardingPacketModule (lazy-loaded with their parent packet route).
import { IdleTruckAlertsComponent } from './components/idle-truck-alerts/idle-truck-alerts.component';
import { LocationsAdminModule } from './components/locations-admin/locations-admin.module';
// FN-770: LoadWizardModule, StepStopsComponent, WizardStepDriverComponent,
// StepAttachmentsComponent moved into LoadsDashboardModule (lazy-loaded).
import { InventoryItemEditDialogComponent } from './components/inventory/inventory-item-edit-dialog/inventory-item-edit-dialog.component';
import { AutoReplenishmentComponent } from './components/auto-replenishment/auto-replenishment.component';
import { AiExtractionFlowComponent } from './components/loads-dashboard/ai-extraction-flow/ai-extraction-flow.component';
import { DailyBriefingComponent } from './components/control-center/daily-briefing/daily-briefing.component';
import { AskBarComponent } from './components/control-center/ask-bar/ask-bar.component';
import { PredictiveInsightsComponent } from './components/control-center/predictive-insights/predictive-insights.component';
import { ExplainPanelComponent } from './components/control-center/explain-panel/explain-panel.component';
import { ControlCenterComponent } from './components/control-center/control-center.component';

@NgModule({
  declarations: [
    AppComponent,
    DashboardPrimitivesComponent,
    RoadsidePrimitivesComponent,
    DashboardComponent,
    DriversComponent,
    DispatchDriversComponent,
    DriverEditComponent,
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
    QuickAddInvoiceModalComponent,
    DuplicateWarningComponent,
    PartLabelPrintComponent,
    MasterTypeaheadComponent,
    ConfidenceBadgeComponent,
    BarcodeScannerDialogComponent,
    InventoryTransfersComponent,
    DirectSalesComponent,
    InventoryReportsComponent,
    PrivacyPolicyComponent,
    TermsComponent,
    CommunicationPreferencesComponent,
    DatePickerComponent,
    MultiMcAdminComponent,
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
    IdleTruckAlertsComponent,
    InventoryItemEditDialogComponent,
    AutoReplenishmentComponent,
    AiExtractionFlowComponent,
    InboundEmailSettingsComponent
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
    LocationsAdminModule,
    DailyBriefingComponent,
    AskBarComponent,
    PredictiveInsightsComponent,
    ExplainPanelComponent,
    ControlCenterComponent
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
