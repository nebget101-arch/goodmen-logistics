import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthGuard } from '../auth.guard';
import { PermissionGuard } from '../guards/permission.guard';
import { PERMISSIONS } from '../models/access-control.model';

import { FuelShellComponent } from './fuel-shell/fuel-shell.component';
import { FuelOverviewComponent } from './fuel-overview/fuel-overview.component';
import { FuelTransactionsComponent } from './fuel-transactions/fuel-transactions.component';
import { FuelImportWizardComponent } from './fuel-import-wizard/fuel-import-wizard.component';
import { FuelImportHistoryComponent } from './fuel-import-history/fuel-import-history.component';
import { FuelCardsComponent } from './fuel-cards/fuel-cards.component';
import { FuelExceptionsComponent } from './fuel-exceptions/fuel-exceptions.component';

const FUEL_PERMS = [
  PERMISSIONS.FUEL_VIEW, PERMISSIONS.FUEL_IMPORT,
  PERMISSIONS.FUEL_CARDS_MANAGE, PERMISSIONS.FUEL_REPORTS_VIEW
];

const routes: Routes = [
  {
    path: '',
    component: FuelShellComponent,
    canActivate: [AuthGuard, PermissionGuard],
    data: { anyPermission: FUEL_PERMS },
    children: [
      { path: '', component: FuelOverviewComponent },
      { path: 'transactions', component: FuelTransactionsComponent },
      {
        path: 'import',
        component: FuelImportWizardComponent,
        canActivate: [PermissionGuard],
        data: { anyPermission: [PERMISSIONS.FUEL_IMPORT] }
      },
      { path: 'history', component: FuelImportHistoryComponent },
      {
        path: 'cards',
        component: FuelCardsComponent,
        canActivate: [PermissionGuard],
        data: { anyPermission: [PERMISSIONS.FUEL_CARDS_MANAGE, PERMISSIONS.FUEL_VIEW] }
      },
      { path: 'exceptions', component: FuelExceptionsComponent },
    ]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class FuelRoutingModule {}
