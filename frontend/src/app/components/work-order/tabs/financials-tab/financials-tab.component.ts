import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { ApiService } from '../../../../services/api.service';
import { PermissionHelperService } from '../../../../services/permission-helper.service';
import { PERMISSIONS } from '../../../../models/access-control.model';

@Component({
  selector: 'app-wo-financials-tab',
  templateUrl: './financials-tab.component.html',
  styleUrls: ['./financials-tab.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WoFinancialsTabComponent {
  @Input() workOrder: any = {};
  @Input() workOrderId: string | null = null;
  @Input() invoiceInfo: any = null;
  @Input() isEditMode = false;

  /* Credit inputs */
  @Input() customerCreditLimit = 0;
  @Input() availableCredit = 0;
  @Input() creditCheckLoading = false;
  @Input() useCustomerCredit = false;
  @Input() creditCheckError = '';

  @Output() generateInvoice = new EventEmitter<void>();
  @Output() useCustomerCreditChange = new EventEmitter<boolean>();

  constructor(
    private apiService: ApiService,
    private permissions: PermissionHelperService
  ) {}

  canGenerateInvoice(): boolean {
    const status = (this.workOrder?.status || '').toString().toUpperCase();
    return status === 'COMPLETED' && this.permissions.hasAnyPermission([PERMISSIONS.INVOICES_CREATE, PERMISSIONS.INVOICES_EDIT]);
  }

  onCreditToggle(value: boolean): void {
    this.useCustomerCreditChange.emit(value);
  }

  /* Status / Workflow fields */

  canCloseWorkOrder(): boolean {
    return this.permissions.hasAnyPermission([PERMISSIONS.WORK_ORDERS_CLOSE, PERMISSIONS.WORK_ORDERS_FINALIZE]);
  }
}
