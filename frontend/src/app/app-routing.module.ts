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

const routes: Routes = [
  { path: '', redirectTo: '/home', pathMatch: 'full' },
  // ─── Public marketing website ───────────────────────────────────────────
  // Accessible without login. Contains: /home (landing) and /home/trial (trial form)
  {
    path: 'home',
    loadChildren: () => import('./public/public.module').then(m => m.PublicModule)
  },
  { path: 'dashboard', component: DashboardComponent, canActivate: [AuthGuard] },
  { path: 'drivers', component: DispatchDriversComponent, canActivate: [AuthGuard] },
  { path: 'drivers/dqf', component: DriversComponent, canActivate: [AuthGuard] },
  { path: 'vehicles', component: VehiclesComponent, canActivate: [AuthGuard], data: { vehicleType: 'truck' } },
  { path: 'trailers', component: VehiclesComponent, canActivate: [AuthGuard], data: { vehicleType: 'trailer' } },
  { path: 'hos', component: HosComponent, canActivate: [AuthGuard] },
  { path: 'maintenance', component: MaintenanceComponent, canActivate: [AuthGuard] },
  { path: 'work-order', component: WorkOrderComponent, canActivate: [AuthGuard] },
  { path: 'work-order/:id', component: WorkOrderComponent, canActivate: [AuthGuard] },
  { path: 'loads', component: LoadsDashboardComponent, canActivate: [AuthGuard] },
  { path: 'dispatch-board', component: DispatchBoardComponent, canActivate: [AuthGuard] },
  { path: 'audit', component: AuditComponent, canActivate: [AuthGuard] },
  { path: 'parts', component: PartsCatalogComponent, canActivate: [AuthGuard] },
  { path: 'barcodes', component: BarcodeManagementComponent, canActivate: [AuthGuard] },
  { path: 'receiving', component: WarehouseReceivingComponent, canActivate: [AuthGuard] },
  { path: 'inventory-transfers', component: InventoryTransfersComponent, canActivate: [AuthGuard] },
  { path: 'direct-sales', component: DirectSalesComponent, canActivate: [AuthGuard] },
  { path: 'inventory-reports', component: InventoryReportsComponent, canActivate: [AuthGuard] },
  // Public driver onboarding packet link (no AuthGuard)
  { path: 'onboard/:packetId', component: OnboardingPacketComponent },
  { path: 'customers', loadChildren: () => import('./customer-management/customer-management.module').then(m => m.CustomerManagementModule) },
  { path: 'invoices', loadChildren: () => import('./invoicing/invoicing.module').then(m => m.InvoicingModule) },
  { path: 'settlements', loadChildren: () => import('./settlements/settlements.module').then(m => m.SettlementsModule) },
  { path: 'reports', loadChildren: () => import('./reports/reports.module').then(m => m.ReportsModule) },
  { path: 'profile', component: ProfileComponent, canActivate: [AuthGuard] },
  { path: 'users/create', component: UserCreateComponent, canActivate: [AuthGuard, PermissionGuard], data: { permission: 'users.create' } },
  {
    path: 'admin/multi-mc',
    component: MultiMcAdminComponent,
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
