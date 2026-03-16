import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthGuard } from '../auth.guard';
import { PermissionGuard } from '../guards/permission.guard';
import { PERMISSIONS } from '../models/access-control.model';

import { TollsShellComponent } from './tolls-shell/tolls-shell.component';
import { TollsOverviewComponent } from './tolls-overview/tolls-overview.component';
import { TollsTransactionsComponent } from './tolls-transactions/tolls-transactions.component';
import { TollsImportComponent } from './tolls-import/tolls-import.component';
import { TollsHistoryComponent } from './tolls-history/tolls-history.component';
import { TollsAccountsComponent } from './tolls-accounts/tolls-accounts.component';
import { TollsDevicesComponent } from './tolls-devices/tolls-devices.component';
import { TollsExceptionsComponent } from './tolls-exceptions/tolls-exceptions.component';

const TOLL_PERMS = [
  PERMISSIONS.TOLLS_VIEW,
  PERMISSIONS.TOLLS_IMPORT,
  PERMISSIONS.TOLLS_ACCOUNTS_MANAGE,
  PERMISSIONS.TOLLS_TRANSACTIONS_EDIT,
  PERMISSIONS.TOLLS_EXCEPTIONS_RESOLVE,
  PERMISSIONS.TOLLS_REPORTS_VIEW,
];

const routes: Routes = [
  {
    path: '',
    component: TollsShellComponent,
    canActivate: [AuthGuard, PermissionGuard],
    data: { anyPermission: TOLL_PERMS },
    children: [
      { path: '', component: TollsOverviewComponent },
      { path: 'transactions', component: TollsTransactionsComponent },
      { path: 'import', component: TollsImportComponent, canActivate: [PermissionGuard], data: { anyPermission: [PERMISSIONS.TOLLS_IMPORT] } },
      { path: 'history', component: TollsHistoryComponent },
      { path: 'accounts', component: TollsAccountsComponent },
      { path: 'devices', component: TollsDevicesComponent },
      { path: 'exceptions', component: TollsExceptionsComponent },
    ]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class TollsRoutingModule {}
