import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { DriversComponent } from './components/drivers/drivers.component';
import { VehiclesComponent } from './components/vehicles/vehicles.component';
import { HosComponent } from './components/hos/hos.component';
import { MaintenanceComponent } from './components/maintenance/maintenance.component';
import { WorkOrderComponent } from './components/work-order/work-order.component';
import { LoadsComponent } from './components/loads/loads.component';
import { AuditComponent } from './components/audit/audit.component';
import { LoginComponent } from './components/login/login.component';
import { AuthGuard } from './auth.guard';
import { UserCreateComponent } from './components/user-create/user-create.component';

const routes: Routes = [
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },
  { path: 'dashboard', component: DashboardComponent, canActivate: [AuthGuard] },
  { path: 'drivers', component: DriversComponent, canActivate: [AuthGuard] },
  { path: 'vehicles', component: VehiclesComponent, canActivate: [AuthGuard] },
  { path: 'hos', component: HosComponent, canActivate: [AuthGuard] },
  { path: 'maintenance', component: MaintenanceComponent, canActivate: [AuthGuard] },
  { path: 'work-order', component: WorkOrderComponent, canActivate: [AuthGuard] },
  { path: 'work-order/:id', component: WorkOrderComponent, canActivate: [AuthGuard] },
  { path: 'loads', component: LoadsComponent, canActivate: [AuthGuard] },
  { path: 'audit', component: AuditComponent, canActivate: [AuthGuard] },
  { path: 'users/create', component: UserCreateComponent, canActivate: [AuthGuard] },
  { path: 'login', component: LoginComponent }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
