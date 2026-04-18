import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { DriversComponent } from './components/drivers/drivers.component';
import { DispatchDriversComponent } from './components/dispatch-drivers/dispatch-drivers.component';
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
import { WarehouseReceivingComponent } from './components/warehouse-receiving/warehouse-receiving.component';
import { InventoryTransfersComponent } from './components/inventory-transfers/inventory-transfers.component';
import { DirectSalesComponent } from './components/direct-sales/direct-sales.component';
import { InventoryReportsComponent } from './components/inventory-reports/inventory-reports.component';
import { OnboardingPacketComponent } from './components/onboarding-packet/onboarding-packet.component';
import { EmploymentApplicationComponent } from './onboarding/employment-application/employment-application.component';
import { PrivacyPolicyComponent } from './components/privacy-policy/privacy-policy.component';
import { TermsComponent } from './components/terms/terms.component';
import { CommunicationPreferencesComponent } from './components/communication-preferences/communication-preferences.component';
import { MultiMcAdminComponent } from './components/multi-mc-admin/multi-mc-admin.component';
import { TrialRequestsAdminComponent } from './components/trial-requests-admin/trial-requests-admin.component';
import { RoadsideBoardComponent } from './components/roadside-board/roadside-board.component';
import { PublicRoadsideComponent } from './components/public-roadside/public-roadside.component';
import { EmployerResponseComponent } from './public/components/employer-response/employer-response.component';
import { PERMISSIONS } from './models/access-control.model';
import { InternalTrialAdminGuard } from './guards/internal-trial-admin.guard';
import { BillingAdminGuard } from './guards/billing-admin.guard';
import { BillingComponent } from './billing/billing.component';
import { IdleTruckAlertsComponent } from './components/idle-truck-alerts/idle-truck-alerts.component';
import { LocationsListComponent } from './components/locations-admin/locations-list/locations-list.component';
import { AutoReplenishmentComponent } from './components/auto-replenishment/auto-replenishment.component';

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
    path: 'loads',
    loadChildren: () => import('./components/loads-dashboard/loads-dashboard.module').then(m => m.LoadsDashboardModule)
  },
  { path: 'dispatch-board', component: DispatchBoardComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/dispatch-board' } },
  {
    path: 'roadside',
    component: RoadsideBoardComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: { anyPermission: [PERMISSIONS.ROADSIDE_VIEW, PERMISSIONS.ROADSIDE_MANAGE], planPath: '/roadside' }
  },
  { path: 'audit', component: AuditComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/audit' } },
  { path: 'parts', component: PartsCatalogComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/parts' } },
  {
    path: 'barcodes',
    loadChildren: () => import('./components/barcode-management/barcode-management.module').then(m => m.BarcodeManagementModule)
  },
  { path: 'receiving', component: WarehouseReceivingComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/receiving' } },
  { path: 'inventory-transfers', component: InventoryTransfersComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/inventory-transfers' } },
  { path: 'direct-sales', component: DirectSalesComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/direct-sales' } },
  { path: 'inventory-reports', component: InventoryReportsComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/inventory-reports' } },
  { path: 'reports/auto-replenishment', component: AutoReplenishmentComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/inventory-reports' } },
  // Employment application standalone route
  { path: 'employment-application', component: EmploymentApplicationComponent },
  // Public driver onboarding packet link (no AuthGuard)
  { path: 'onboard/:packetId', component: OnboardingPacketComponent },
  { path: 'roadside/:callId', component: PublicRoadsideComponent },
  // Public employer investigation response (no AuthGuard — token-validated)
  { path: 'employer-response/:tokenId', component: EmployerResponseComponent },
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
    component: TrialRequestsAdminComponent,
    canActivate: [AuthGuard, InternalTrialAdminGuard]
  },
  {
    path: 'admin/locations',
    component: LocationsListComponent,
    canActivate: [AuthGuard, PermissionGuard],
    data: { anyPermission: [PERMISSIONS.LOCATIONS_MANAGE, PERMISSIONS.LOCATIONS_VIEW] }
  },
  { path: 'login', component: LoginComponent },
  { path: 'forgot-password', component: ForgotPasswordComponent },
  { path: 'reset-password', component: ResetPasswordComponent },
  { path: 'privacy', component: PrivacyPolicyComponent },
  { path: 'terms', component: TermsComponent },
  { path: 'communication-preferences', component: CommunicationPreferencesComponent }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
