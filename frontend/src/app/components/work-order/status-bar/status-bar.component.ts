import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { PermissionHelperService } from '../../../services/permission-helper.service';
import { PERMISSIONS } from '../../../models/access-control.model';

@Component({
  selector: 'app-wo-status-bar',
  templateUrl: './status-bar.component.html',
  styleUrls: ['./status-bar.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WoStatusBarComponent {
  readonly perms = PERMISSIONS;

  @Input() workOrder: any = {};
  @Input() invoiceInfo: any = null;
  @Input() isEditMode = false;
  @Input() workOrderSaveError = '';
  @Input() workOrderSaveSuccess = '';
  @Input() workOrderLoadError = '';

  @Output() save = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();
  @Output() generateInvoice = new EventEmitter<void>();

  constructor(private permissions: PermissionHelperService) {}

  canEditWorkOrder(): boolean {
    return this.permissions.hasAnyPermission([PERMISSIONS.WORK_ORDERS_EDIT, PERMISSIONS.WORK_ORDERS_CREATE]);
  }

  canCloseWorkOrder(): boolean {
    return this.permissions.hasAnyPermission([PERMISSIONS.WORK_ORDERS_CLOSE, PERMISSIONS.WORK_ORDERS_FINALIZE]);
  }

  canGenerateInvoice(): boolean {
    const status = (this.workOrder?.status || '').toString().toUpperCase();
    return status === 'COMPLETED' && this.permissions.hasAnyPermission([PERMISSIONS.INVOICES_CREATE, PERMISSIONS.INVOICES_EDIT]);
  }

  getStatusClass(): string {
    const status = (this.workOrder?.status || 'DRAFT').toUpperCase();
    switch (status) {
      case 'DRAFT': return 'status-draft';
      case 'IN_PROGRESS': return 'status-in-progress';
      case 'WAITING_PARTS': return 'status-waiting';
      case 'COMPLETED': return 'status-completed';
      case 'CLOSED': return 'status-closed';
      case 'CANCELED': return 'status-canceled';
      default: return 'status-draft';
    }
  }

  isClosingDisabled(): boolean {
    const status = (this.workOrder?.status || '').toString().toUpperCase();
    return !this.canEditWorkOrder() || (status === 'CLOSED' && !this.canCloseWorkOrder());
  }

  getSaveTooltip(): string {
    if (!this.canEditWorkOrder()) return 'You do not have permission to edit work orders.';
    const status = (this.workOrder?.status || '').toString().toUpperCase();
    if (status === 'CLOSED' && !this.canCloseWorkOrder()) return 'Only manager-level users can close a work order.';
    return '';
  }
}
