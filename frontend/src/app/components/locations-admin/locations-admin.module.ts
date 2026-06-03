import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { LocationsListComponent } from './locations-list/locations-list.component';
import { BinsTabComponent } from './bins-tab/bins-tab.component';
import { LocationEditDialogComponent } from './location-edit-dialog/location-edit-dialog.component';
import { UsersTabComponent } from './location-edit-dialog/users-tab/users-tab.component';
import { SupplyRulesTabComponent } from './location-edit-dialog/supply-rules-tab/supply-rules-tab.component';
import { DeleteLocationDialogComponent } from './delete-location-dialog/delete-location-dialog.component';

@NgModule({
  declarations: [
    LocationsListComponent,
    BinsTabComponent,
    LocationEditDialogComponent,
    UsersTabComponent,
    SupplyRulesTabComponent,
    DeleteLocationDialogComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    RouterModule
  ],
  exports: [
    LocationsListComponent,
    BinsTabComponent,
    LocationEditDialogComponent,
    UsersTabComponent,
    SupplyRulesTabComponent,
    DeleteLocationDialogComponent
  ]
})
export class LocationsAdminModule {}
