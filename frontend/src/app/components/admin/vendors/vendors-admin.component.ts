import { Component } from '@angular/core';
import { Vendor } from '../../../services/vendors.service';

@Component({
  selector: 'app-vendors-admin',
  template: `
    <app-vendors-list
      *ngIf="!formOpen"
      (createVendor)="openCreate()"
      (editVendor)="openEdit($event)"
    ></app-vendors-list>
    <app-vendor-form
      *ngIf="formOpen"
      [vendor]="editTarget"
      (saved)="onSaved($event)"
      (cancelled)="closeForm()"
    ></app-vendor-form>
  `,
})
export class VendorsAdminComponent {
  formOpen = false;
  editTarget: Vendor | null = null;

  openCreate(): void {
    this.editTarget = null;
    this.formOpen = true;
  }

  openEdit(vendor: Vendor): void {
    this.editTarget = vendor;
    this.formOpen = true;
  }

  onSaved(_vendor: Vendor): void {
    this.closeForm();
  }

  closeForm(): void {
    this.formOpen = false;
    this.editTarget = null;
  }
}
