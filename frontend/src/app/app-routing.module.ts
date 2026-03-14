import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { DriversComponent } from './components/drivers/drivers.component';
import { DispatchDriversComponent } from './components/dispatch-drivers/dispatch-drivers.component';
import { VehiclesComponent } from './components/vehicles/vehicles.component';
import { HosComponent } from './components/hos/hos.component';
import { MaintenanceComponent } from './components/maintenance/maintenance.component';
import { WorkOrderComponent } from './components/work-order/work-order.component';
import { LoadsComponent } from './components/loads/loads.component';
import { LoadsDashboardComponent } from './components/loads-dashboard/loads-dashboard.component';
import { DispatchBoardComponent } from './components/dispatch-board/dispatch-board.component';
import { AuditComponent } from './components/audit/audit.component';
import { LoginComponent } from './components/login/login.component';
import { AuthGuard } from './auth.guard';
import { PermissionGuard } from './guards/permission.guard';
import { PlanGuard } from './guards/plan.guard';
import { UserCreateComponent } from './components/user-create/user-create.component';
import { ProfileComponent } from './components/profile/profile.component';
import { PartsCatalogComponent } from './components/parts-catalog/parts-catalog.component';
import { BarcodeManagementComponent } from './components/barcode-management/barcode-management.component';
import { WarehouseReceivingComponent } from './components/warehouse-receiving/warehouse-receiving.component';
import { InventoryTransfersComponent } from './components/inventory-transfers/inventory-transfers.component';
import { DirectSalesComponent } from './components/direct-sales/direct-sales.component';
import { InventoryReportsComponent } from './components/inventory-reports/inventory-reports.component';
import { OnboardingPacketComponent } from './components/onboarding-packet/onboarding-packet.component';
import { PrivacyPolicyComponent } from './components/privacy-policy/privacy-policy.component';
import { TermsComponent } from './components/terms/terms.component';
import { CommunicationPreferencesComponent } from './components/communication-preferences/communication-preferences.component';
import { MultiMcAdminComponent } from './components/multi-mc-admin/multi-mc-admin.component';
import { TrialRequestsAdminComponent } from './components/trial-requests-admin/trial-requests-admin.component';
import { RoadsideBoardComponent } from './components/roadside-board/roadside-board.component';
import { PublicRoadsideComponent } from './components/public-roadside/public-roadside.component';

const routes: Routes = [
  { path: '', redirectTo: '/home', pathMatch: 'full' },
  // ─── Public marketing website ───────────────────────────────────────────
  // Accessible without login. Contains: /home (landing) and /home/trial (trial form)
  {
    path: 'home',
    loadChildren: () => import('./public/public.module').then(m => m.PublicModule)
  },
  { path: 'dashboard', component: DashboardComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/dashboard' } },
  { path: 'drivers', component: DispatchDriversComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/drivers' } },
  { path: 'drivers/dqf', component: DriversComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/drivers/dqf' } },
  { path: 'vehicles', component: VehiclesComponent, canActivate: [AuthGuard, PlanGuard], data: { vehicleType: 'truck', planPath: '/vehicles' } },
  { path: 'trailers', component: VehiclesComponent, canActivate: [AuthGuard, PlanGuard], data: { vehicleType: 'trailer', planPath: '/trailers' } },
  { path: 'hos', component: HosComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/hos' } },
  { path: 'maintenance', component: MaintenanceComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/maintenance' } },
  { path: 'work-order', component: WorkOrderComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/work-order' } },
  { path: 'work-order/:id', component: WorkOrderComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/work-order' } },
  { path: 'loads', component: LoadsDashboardComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/loads' } },
  { path: 'dispatch-board', component: DispatchBoardComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/dispatch-board' } },
  {
    path: 'roadside',
    component: RoadsideBoardComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: { anyPermission: ['roadside.view', 'roadside.manage'], planPath: '/roadside' }
  },
  { path: 'audit', component: AuditComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/audit' } },
  { path: 'parts', component: PartsCatalogComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/parts' } },
  { path: 'barcodes', component: BarcodeManagementComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/barcodes' } },
  { path: 'receiving', component: WarehouseReceivingComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/receiving' } },
  { path: 'inventory-transfers', component: InventoryTransfersComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/inventory-transfers' } },
  { path: 'direct-sales', component: DirectSalesComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/direct-sales' } },
  { path: 'inventory-reports', component: InventoryReportsComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/inventory-reports' } },
  // Public driver onboarding packet link (no AuthGuard)
  { path: 'onboard/:packetId', component: OnboardingPacketComponent },
  { path: 'roadside/:callId', component: PublicRoadsideComponent },
  { path: 'customers', loadChildren: () => import('./customer-management/customer-management.module').then(m => m.CustomerManagementModule) },
  { path: 'invoices', loadChildren: () => import('./invoicing/invoicing.module').then(m => m.InvoicingModule) },
  { path: 'settlements', loadChildren: () => import('./settlements/settlements.module').then(m => m.SettlementsModule) },
  { path: 'reports', loadChildren: () => import('./reports/reports.module').then(m => m.ReportsModule) },
  { path: 'profile', component: ProfileComponent, canActivate: [AuthGuard] },
  { path: 'users/create', component: UserCreateComponent, canActivate: [AuthGuard, PermissionGuard], data: { permission: 'users.create' } },
  {
    path: 'admin/multi-mc',
    component: MultiMcAdminComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: { anyPermission: ['roles.manage', 'access.admin', 'users.edit'], planPath: '/admin/multi-mc' }
  },
  {
    path: 'admin/trial-requests',
    component: TrialRequestsAdminComponent,
    canActivate: [AuthGuard, PermissionGuard],
    data: { anyPermission: ['roles.manage', 'access.admin', 'users.edit'] }
  },
  { path: 'login', component: LoginComponent },
  { path: 'privacy', component: PrivacyPolicyComponent },
  { path: 'terms', component: TermsComponent },
  { path: 'communication-preferences', component: CommunicationPreferencesComponent }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
