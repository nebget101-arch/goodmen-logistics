import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { TollsRoutingModule } from './tolls-routing.module';
import { TollsShellComponent } from './tolls-shell/tolls-shell.component';
import { TollsOverviewComponent } from './tolls-overview/tolls-overview.component';
import { TollsTransactionsComponent } from './tolls-transactions/tolls-transactions.component';
import { TollsImportComponent } from './tolls-import/tolls-import.component';
import { TollsHistoryComponent } from './tolls-history/tolls-history.component';
import { TollsAccountsComponent } from './tolls-accounts/tolls-accounts.component';
import { TollsDevicesComponent } from './tolls-devices/tolls-devices.component';
import { TollsExceptionsComponent } from './tolls-exceptions/tolls-exceptions.component';

@NgModule({
  declarations: [
    TollsShellComponent,
    TollsOverviewComponent,
    TollsTransactionsComponent,
    TollsImportComponent,
    TollsHistoryComponent,
    TollsAccountsComponent,
    TollsDevicesComponent,
    TollsExceptionsComponent,
  ],
  imports: [
    CommonModule,
    FormsModule,
    TollsRoutingModule,
  ]
})
export class TollsModule {}
