import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { LocationsListComponent } from './locations-list/locations-list.component';

@NgModule({
  declarations: [
    LocationsListComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule
  ],
  exports: [
    LocationsListComponent
  ]
})
export class LocationsAdminModule {}
