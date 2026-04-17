import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BinsTabComponent } from './bins-tab/bins-tab.component';

@NgModule({
  declarations: [
    BinsTabComponent
  ],
  imports: [
    CommonModule,
    FormsModule
  ],
  exports: [
    BinsTabComponent
  ]
})
export class LocationsAdminModule {}
