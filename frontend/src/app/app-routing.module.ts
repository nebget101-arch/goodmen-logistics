import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
// FN-1636 — dev-only primitives showcase
import { DashboardPrimitivesComponent } from './dev/dashboard-primitives/dashboard-primitives.component';
// FN-1644 — dev-only Roadside primitives sandbox
import { RoadsidePrimitivesComponent } from './components/dev/roadside-primitives/roadside-primitives.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { DriversComponent } from './components/drivers/drivers.component';
import { DispatchDriversComponent } from './components/dispatch-drivers/dispatch-drivers.component';
import { DriverEditComponent } from './components/driver-edit/driver-edit.component';
import { VehiclesComponent } from './components/vehicles/vehicles.component';
import { HosComponent } from './components/hos/hos.component';
import { LoadsComponent } from './components/loads/loads.component';
import { DispatchBoardComponent } from './components/dispatch-board/dispatch-board.component';
import { AuditComponent } from './components/audit/audit.component';
import { LoginComponent } from './components/login/login.component';
import { ForgotPasswordComponent } from './components/forgot-password/forgot-password.component';
import { ResetPasswordComponent } from './components/reset-password/reset-password.component';
import { AuthGuard } from './auth.guard';
import { PermissionGuard } from './guards/permission.guard';
import { PlanGuard } from './guards/plan.guard';
import { UserCreateComponent } from './components/user-create/user-create.component';
import { UsersAdminComponent } from './components/users-admin/users-admin.component';
import { ProfileComponent } from './components/profile/profile.component';
import { PartsCatalogComponent } from './components/parts-catalog/parts-catalog.component';
// FN-1549: warehouse-receiving, onboarding-packet, employment-application,
// trial-requests-admin, and fmcsa-imports are lazy-loaded via loadChildren
// below — see their feature modules.
import { InventoryTransfersComponent } from './components/inventory-transfers/inventory-transfers.component';
import { DirectSalesComponent } from './components/direct-sales/direct-sales.component';
import { InventoryReportsComponent } from './components/inventory-reports/inventory-reports.component';
import { PrivacyPolicyComponent } from './components/privacy-policy/privacy-policy.component';
import { TermsComponent } from './components/terms/terms.component';
import { CommunicationPreferencesComponent } from './components/communication-preferences/communication-preferences.component';
import { MultiMcAdminComponent } from './components/multi-mc-admin/multi-mc-admin.component';
import { InboundEmailSettingsComponent } from './components/admin/inbound-email-settings/inbound-email-settings.component';
import { BrandingSettingsComponent } from './settings/branding/branding-settings.component';
import { RoadsideBoardComponent } from './components/roadside-board/roadside-board.component';
import { PublicRoadsideComponent } from './components/public-roadside/public-roadside.component';
import { EmployerResponseComponent } from './public/components/employer-response/employer-response.component';
import { PERMISSIONS } from './models/access-control.model';
// FN-1549: InternalTrialAdminGuard / InternalTenantGuard now applied inside
// the lazy admin route modules (trial-requests-admin, fmcsa-imports).
import { BillingAdminGuard } from './guards/billing-admin.guard';
import { BillingComponent } from './billing/billing.component';
import { IdleTruckAlertsComponent } from './components/idle-truck-alerts/idle-truck-alerts.component';
import { LocationsListComponent } from './components/locations-admin/locations-list/locations-list.component';
import { AutoReplenishmentComponent } from './components/auto-replenishment/auto-replenishment.component';
import { environment } from '../environments/environment';
// FN-1261 — Driver portal incident detail
import { IncidentDetailComponent } from './components/driver-portal/incident-detail/incident-detail.component';

const routes: Routes = [
  { path: '', redirectTo: '/home', pathMatch: 'full' },
  // ─── Public marketing website ───────────────────────────────────────────
  // Accessible without login. Contains: /home (landing) and /home/trial (trial form)
  {
    path: 'home',
    loadChildren: () => import('./public/public.module').then(m => m.PublicModule)
  },
  {
    path: 'trial-signup',
    redirectTo: '/home/trial-signup',
    pathMatch: 'full'
  },
  {
    path: 'trial-signup/:token',
    redirectTo: '/home/trial-signup/:token',
    pathMatch: 'full'
  },
  {
    path: 'contact',
    redirectTo: '/home/contact',
    pathMatch: 'full'
  },
  {
    path: 'contact-us',
    redirectTo: '/home/contact',
    pathMatch: 'full'
  },
  { path: 'dashboard', component: DashboardComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/dashboard' } },
  { path: 'drivers', component: DispatchDriversComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/drivers' } },
  { path: 'drivers/dqf', component: DriversComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/drivers/dqf' } },
  { path: 'drivers/:id/edit', component: DriverEditComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/drivers' } },
  {
    path: 'vehicles',
    component: VehiclesComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: {
      vehicleType: 'truck',
      planPath: '/vehicles',
      anyPermission: [PERMISSIONS.VEHICLES_VIEW, PERMISSIONS.VEHICLES_CREATE, PERMISSIONS.VEHICLES_EDIT]
    }
  },
  {
    path: 'trailers',
    component: VehiclesComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: {
      vehicleType: 'trailer',
      planPath: '/trailers',
      anyPermission: [PERMISSIONS.VEHICLES_VIEW, PERMISSIONS.VEHICLES_CREATE, PERMISSIONS.VEHICLES_EDIT]
    }
  },
  {
    // Lazy-loaded to keep Leaflet out of the initial bundle (FN-770 pattern).
    path: 'vehicle-tracking',
    loadChildren: () => import('./components/vehicle-tracking/vehicle-tracking.module').then(m => m.VehicleTrackingModule)
  },
  { path: 'hos', component: HosComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/hos' } },
  // FN-770: lazy-load heavy routes to keep initial bundle under budget.
  {
    path: 'maintenance',
    loadChildren: () => import('./components/maintenance/maintenance.module').then(m => m.MaintenanceModule)
  },
  {
    path: 'work-order',
    loadChildren: () => import('./components/work-order/work-order.module').then(m => m.WorkOrderModule)
  },
  {
    // FN-1594: spreadsheet import wizard. Registered before the lazy `loads`
    // route so `/loads/import` resolves to this module rather than falling
    // through to LoadsDashboardModule's children.
    path: 'loads/import',
    loadChildren: () => import('./loads/loads-import-wizard/loads-import.module').then(m => m.LoadsImportModule),
    canActivate: [AuthGuard, PlanGuard],
    data: { planPath: '/loads' }
  },
  {
    path: 'loads',
    loadChildren: () => import('./components/loads-dashboard/loads-dashboard.module').then(m => m.LoadsDashboardModule)
  },
  { path: 'dispatch-board', component: DispatchBoardComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/dispatch-board' } },
  {
    path: 'geofences',
    loadChildren: () => import('./components/geofences/geofences.module').then(m => m.GeofencesModule)
  },
  {
    // FN-1671 — live fleet map; lazy-loaded to keep leaflet.markercluster out
    // of the initial bundle (mirrors the geofences route above).
    path: 'tracking',
    loadChildren: () => import('./components/tracking-map/tracking-map.module').then(m => m.TrackingMapModule)
  },
  {
    path: 'roadside',
    component: RoadsideBoardComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: { anyPermission: [PERMISSIONS.ROADSIDE_VIEW, PERMISSIONS.ROADSIDE_MANAGE], planPath: '/roadside' }
  },
  // FN-1261 — Driver portal incident detail (shell route /driver-portal added by FN-1204)
  { path: 'driver-portal/incidents/:id', component: IncidentDetailComponent, canActivate: [AuthGuard] },
  { path: 'audit', component: AuditComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/audit' } },
  { path: 'parts', component: PartsCatalogComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/parts' } },
  {
    path: 'barcodes',
    loadChildren: () => import('./components/barcode-management/barcode-management.module').then(m => m.BarcodeManagementModule)
  },
  {
    path: 'receiving',
    loadChildren: () => import('./components/warehouse-receiving/warehouse-receiving.module').then(m => m.WarehouseReceivingModule)
  },
  { path: 'inventory-transfers', component: InventoryTransfersComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/inventory-transfers' } },
  { path: 'direct-sales', component: DirectSalesComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/direct-sales' } },
  { path: 'inventory-reports', component: InventoryReportsComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/inventory-reports' } },
  { path: 'reports/auto-replenishment', component: AutoReplenishmentComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/inventory-reports' } },
  // Employment application standalone route (lazy — FN-1549)
  {
    path: 'employment-application',
    loadChildren: () => import('./onboarding/employment-application/employment-application.module').then(m => m.EmploymentApplicationModule)
  },
  // Public driver onboarding packet link (no AuthGuard, lazy — FN-1549)
  {
    path: 'onboard/:packetId',
    loadChildren: () => import('./components/onboarding-packet/onboarding-packet.module').then(m => m.OnboardingPacketModule)
  },
  { path: 'roadside/:callId', component: PublicRoadsideComponent },
  // Public employer investigation response (no AuthGuard — token-validated)
  { path: 'employer-response/:tokenId', component: EmployerResponseComponent },
  // FN-1678 (Story F) — public shipment tracking. Unauthenticated, no app
  // shell, no guard; token-validated server-side. Lazy standalone component so
  // the map library stays out of the authenticated bundle.
  {
    path: 'track/:token',
    loadComponent: () =>
      import('./public-track/public-track.component').then(m => m.PublicTrackComponent)
  },
  { path: 'shop-clients', loadChildren: () => import('./customer-management/customer-management.module').then(m => m.CustomerManagementModule) },
  { path: 'invoices', loadChildren: () => import('./invoicing/invoicing.module').then(m => m.InvoicingModule) },
  { path: 'settlements', loadChildren: () => import('./settlements/settlements.module').then(m => m.SettlementsModule) },
  {
    path: 'fuel',
    loadChildren: () => import('./fuel/fuel.module').then(m => m.FuelModule),
    canActivate: [AuthGuard, PermissionGuard],
    data: {
      anyPermission: [
        PERMISSIONS.FUEL_VIEW,
        PERMISSIONS.FUEL_IMPORT,
        PERMISSIONS.FUEL_CARDS_MANAGE,
        PERMISSIONS.FUEL_EXCEPTIONS_RESOLVE,
        PERMISSIONS.FUEL_REPORTS_VIEW
      ]
    }
  },
  {
    path: 'tolls',
    loadChildren: () => import('./tolls/tolls.module').then(m => m.TollsModule),
    canActivate: [AuthGuard, PermissionGuard],
    data: {
      anyPermission: [
        PERMISSIONS.TOLLS_VIEW,
        PERMISSIONS.TOLLS_IMPORT,
        PERMISSIONS.TOLLS_ACCOUNTS_MANAGE,
        PERMISSIONS.TOLLS_EXCEPTIONS_RESOLVE,
        PERMISSIONS.TOLLS_REPORTS_VIEW
      ]
    }
  },
  {
    path: 'finance/lease-to-own',
    loadChildren: () => import('./lease-financing/lease-financing.module').then(m => m.LeaseFinancingModule),
    canActivate: [AuthGuard, PermissionGuard],
    data: {
      anyPermission: [
        PERMISSIONS.LEASE_FINANCING_VIEW,
        PERMISSIONS.LEASE_FINANCING_CREATE,
        PERMISSIONS.LEASE_FINANCING_EDIT,
        PERMISSIONS.LEASE_FINANCING_DASHBOARD_VIEW,
        PERMISSIONS.LEASE_FINANCING_DRIVER_VIEW,
      ]
    }
  },
  {
    path: 'safety',
    loadChildren: () => import('./safety/safety.module').then(m => m.SafetyModule),
    canActivate: [AuthGuard, PermissionGuard],
    data: {
      anyPermission: [
        PERMISSIONS.SAFETY_INCIDENTS_VIEW,
        PERMISSIONS.SAFETY_INCIDENTS_CREATE,
        PERMISSIONS.SAFETY_INCIDENTS_EDIT,
        PERMISSIONS.SAFETY_CLAIMS_VIEW,
        PERMISSIONS.SAFETY_CLAIMS_CREATE,
        PERMISSIONS.SAFETY_CLAIMS_EDIT,
        PERMISSIONS.SAFETY_REPORTS_VIEW,
      ]
    }
  },
  {
    path: 'compliance/ifta',
    loadChildren: () => import('./compliance/compliance.module').then(m => m.ComplianceModule),
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: {
      planPath: '/compliance/ifta',
      anyPermission: [
        PERMISSIONS.IFTA_VIEW,
        PERMISSIONS.IFTA_EDIT,
        PERMISSIONS.IFTA_IMPORT,
        PERMISSIONS.IFTA_RUN_AI_REVIEW,
        PERMISSIONS.IFTA_FINALIZE,
        PERMISSIONS.IFTA_EXPORT,
      ]
    }
  },
  { path: 'reports', loadChildren: () => import('./reports/reports.module').then(m => m.ReportsModule) },
  {
    path: 'idle-truck-alerts',
    component: IdleTruckAlertsComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: { planPath: '/settlements', anyPermission: [PERMISSIONS.SETTLEMENTS_VIEW, PERMISSIONS.SETTLEMENTS_EDIT] }
  },
  { path: 'profile', component: ProfileComponent, canActivate: [AuthGuard] },
  { path: 'billing', component: BillingComponent, canActivate: [AuthGuard, BillingAdminGuard] },
  {
    path: 'users',
    component: UsersAdminComponent,
    canActivate: [AuthGuard, PermissionGuard],
    data: { anyPermission: [PERMISSIONS.USERS_VIEW, PERMISSIONS.USERS_CREATE, PERMISSIONS.USERS_EDIT, PERMISSIONS.ROLES_MANAGE, PERMISSIONS.ACCESS_ADMIN] }
  },
  { path: 'users/create', component: UserCreateComponent, canActivate: [AuthGuard, PermissionGuard], data: { permission: PERMISSIONS.USERS_CREATE } },
  {
    path: 'admin/multi-mc',
    component: MultiMcAdminComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: { anyPermission: [PERMISSIONS.ROLES_MANAGE, PERMISSIONS.ACCESS_ADMIN, PERMISSIONS.USERS_EDIT], planPath: '/admin/multi-mc' }
  },
  {
    path: 'admin/trial-requests',
    loadChildren: () => import('./components/trial-requests-admin/trial-requests-admin.module').then(m => m.TrialRequestsAdminModule)
  },
  {
    path: 'admin/locations',
    component: LocationsListComponent,
    canActivate: [AuthGuard, PermissionGuard],
    data: { anyPermission: [PERMISSIONS.LOCATIONS_MANAGE, PERMISSIONS.LOCATIONS_VIEW] }
  },
  {
    path: 'admin/inbound-email',
    component: InboundEmailSettingsComponent,
    canActivate: [AuthGuard, PermissionGuard],
    data: { anyPermission: [PERMISSIONS.ROLES_MANAGE, PERMISSIONS.ACCESS_ADMIN, PERMISSIONS.USERS_EDIT] }
  },
  {
    path: 'admin/branding',
    component: BrandingSettingsComponent,
    canActivate: [AuthGuard, PermissionGuard],
    data: { anyPermission: [PERMISSIONS.ACCESS_ADMIN, PERMISSIONS.ROLES_MANAGE, PERMISSIONS.LOCATIONS_MANAGE] }
  },
  {
    path: 'admin/fmcsa-imports',
    loadChildren: () => import('./components/admin/fmcsa-imports/fmcsa-imports.module').then(m => m.FmcsaImportsAdminModule)
  },
  {
    path: 'admin/vendors',
    loadChildren: () => import('./components/admin/vendors/vendors-admin.module').then(m => m.VendorsAdminModule)
  },
  // FN-1326 — dev-only severity-system preview. Excluded from production builds
  // so the route does not ship to customers; lazy-loaded so it adds zero bundle
  // weight unless explicitly visited in dev.
  ...(environment.production
    ? []
    : [{
        path: 'dev/severity-preview',
        loadComponent: () =>
          import('./dev/severity-preview/severity-preview.component')
            .then(m => m.SeverityPreviewComponent)
      }]),
  { path: 'login', component: LoginComponent },
  { path: 'forgot-password', component: ForgotPasswordComponent },
  { path: 'reset-password', component: ResetPasswordComponent },
  { path: 'privacy', component: PrivacyPolicyComponent },
  { path: 'terms', component: TermsComponent },
  { path: 'communication-preferences', component: CommunicationPreferencesComponent },
  // FN-1636 — dev-only primitives showcase; excluded from production builds.
  ...(environment.production
    ? []
    : [{ path: 'dev/dashboard-primitives', component: DashboardPrimitivesComponent }]),
  // FN-1644 — dev-only Roadside primitives sandbox; excluded from production builds.
  ...(environment.production
    ? []
    : [{ path: 'dev/roadside-primitives', component: RoadsidePrimitivesComponent }])
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
