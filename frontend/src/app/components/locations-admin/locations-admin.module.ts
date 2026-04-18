import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { LocationsListComponent } from './locations-list/locations-list.component';
import { BinsTabComponent } from './bins-tab/bins-tab.component';

@NgModule({
  declarations: [
    LocationsListComponent,
    BinsTabComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule
  ],
  exports: [
    LocationsListComponent,
    BinsTabComponent
  ]
})
export class LocationsAdminModule {}
