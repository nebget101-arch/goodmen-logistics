import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
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
  @Output() sendInvoice = new EventEmitter<void>();
  @Output() useCustomerCreditChange = new EventEmitter<boolean>();

  constructor(private permissions: PermissionHelperService) {}

  // ─── Permissions ──────────────────────────────────────────────────────────

  canGenerateInvoice(): boolean {
    const status = (this.workOrder?.status || '').toString().toUpperCase();
    return status === 'COMPLETED' && this.permissions.hasAnyPermission([PERMISSIONS.INVOICES_CREATE, PERMISSIONS.INVOICES_EDIT]);
  }

  canSendInvoice(): boolean {
    return !!this.invoiceInfo?.id
      && (this.invoiceInfo?.status || '').toUpperCase() === 'DRAFT'
      && this.permissions.hasAnyPermission([PERMISSIONS.INVOICES_CREATE, PERMISSIONS.INVOICES_EDIT]);
  }

  canCloseWorkOrder(): boolean {
    return this.permissions.hasAnyPermission([PERMISSIONS.WORK_ORDERS_CLOSE, PERMISSIONS.WORK_ORDERS_FINALIZE]);
  }

  // ─── Billing helpers ───────────────────────────────────────────────────────

  /** True when this work order is non-billable (Internal cost type). */
  get isInternalWorkOrder(): boolean {
    return (this.workOrder?.costType || '').toString().toLowerCase() === 'internal';
  }

  get invoiceStatusLabel(): string {
    const s = (this.invoiceInfo?.status || '').toUpperCase();
    switch (s) {
      case 'DRAFT':   return 'Draft';
      case 'SENT':    return 'Sent';
      case 'PAID':    return 'Paid';
      case 'VOID':    return 'Void';
      case 'OVERDUE': return 'Overdue';
      default:        return s || 'Draft';
    }
  }

  get invoiceStatusClass(): string {
    const s = (this.invoiceInfo?.status || '').toUpperCase();
    switch (s) {
      case 'DRAFT':   return 'inv-status inv-draft';
      case 'SENT':    return 'inv-status inv-sent';
      case 'PAID':    return 'inv-status inv-paid';
      case 'VOID':    return 'inv-status inv-void';
      case 'OVERDUE': return 'inv-status inv-overdue';
      default:        return 'inv-status inv-draft';
    }
  }

  /** Credit breakdown: balance due after credit applied. */
  get balanceDue(): number {
    const total = Number(this.invoiceInfo?.total_amount || this.workOrder?.totalCost || 0);
    const credit = Number(this.invoiceInfo?.credit_applied || 0);
    return Math.max(0, total - credit);
  }

  get hasCreditApplied(): boolean {
    return Number(this.invoiceInfo?.credit_applied || 0) > 0;
  }

  // ─── Events ────────────────────────────────────────────────────────────────

  onCreditToggle(value: boolean): void {
    this.useCustomerCreditChange.emit(value);
  }

  onGenerateInvoice(): void {
    this.generateInvoice.emit();
  }

  onSendInvoice(): void {
    this.sendInvoice.emit();
  }
}
