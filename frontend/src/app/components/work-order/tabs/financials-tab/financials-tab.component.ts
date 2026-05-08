import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { PermissionHelperService } from '../../../../services/permission-helper.service';
import { PERMISSIONS } from '../../../../models/access-control.model';

const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia'
};

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

  showTaxTooltip = false;

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

  // ─── Tax engine helpers (FN-1539) ─────────────────────────────────────────

  get taxBreakdown(): any {
    return this.workOrder?.taxBreakdown || null;
  }

  get isTaxOverride(): boolean {
    return this.workOrder?.taxRateOverride === true;
  }

  /** Effective rate as a percentage (e.g. 6.25). Prefers breakdown.rate (fraction) over taxRatePercent. */
  get effectiveTaxRatePercent(): number {
    const bd = this.taxBreakdown;
    if (bd && typeof bd.rate === 'number') return bd.rate * 100;
    const rp = Number(this.workOrder?.taxRatePercent);
    return Number.isFinite(rp) ? rp : 0;
  }

  get taxTooltipTitle(): string {
    const bd = this.taxBreakdown;
    if (!bd) return 'Tax';
    if (bd.override) {
      return `Manual override: ${this.formatRate(this.effectiveTaxRatePercent)}%`;
    }
    if (bd.rule_state) {
      const name = US_STATE_NAMES[(bd.rule_state || '').toUpperCase()] || bd.rule_state;
      return `${name} (${bd.rule_state}) — ${this.formatRate(this.effectiveTaxRatePercent)}%`;
    }
    return 'Tax';
  }

  get taxTooltipDetail(): string {
    const bd = this.taxBreakdown;
    if (!bd) return 'Tax will be computed when the work order is saved.';

    const lines: string[] = [];
    if (bd.override) {
      lines.push(`Rate manually set to ${this.formatRate(this.effectiveTaxRatePercent)}%.`);
    }
    if (bd.fallback_reason === 'no-location') {
      lines.push('No location selected — tax skipped.');
    } else if (bd.fallback_reason === 'no-state') {
      lines.push('Location has no state — using legacy 8.5% rate.');
    } else if (bd.fallback_reason === 'no-rule-for-state') {
      lines.push(`No state rule for ${bd.rule_state || 'this state'} — using legacy 8.5% rate.`);
    }

    const flags: string[] = [];
    if (bd.labor_taxable === true) flags.push('labor taxable');
    if (bd.labor_taxable === false) flags.push('labor not taxable');
    if (bd.parts_taxable === true) flags.push('parts taxable');
    if (bd.parts_taxable === false) flags.push('parts not taxable');
    if (bd.fees_taxable === true) flags.push('fees taxable');
    if (bd.fees_taxable === false) flags.push('fees not taxable');
    if (flags.length) lines.push(this.capitalize(flags.join('; ')) + '.');

    if (bd.taxable_subtotal != null) {
      lines.push(`Taxable subtotal: $${Number(bd.taxable_subtotal).toFixed(2)}.`);
    }
    if (bd.discount_amount && Number(bd.discount_amount) > 0 && bd.taxable_after_discount != null) {
      lines.push(`After discount: $${Number(bd.taxable_after_discount).toFixed(2)}.`);
    }
    return lines.join(' ');
  }

  toggleTaxTooltip(): void {
    this.showTaxTooltip = !this.showTaxTooltip;
  }

  enableTaxOverride(): void {
    this.workOrder.taxRateOverride = true;
    if (this.workOrder.taxRatePercent == null) {
      this.workOrder.taxRatePercent = Number(this.effectiveTaxRatePercent.toFixed(4));
    }
  }

  /** Revert restores the state default — server picks the rule on next save. */
  revertTaxOverride(): void {
    this.workOrder.taxRateOverride = false;
    this.workOrder.taxRatePercent = null;
  }

  onTaxRatePercentChange(value: any): void {
    const num = Number(value);
    this.workOrder.taxRatePercent = Number.isFinite(num) ? num : 0;
  }

  private formatRate(rate: number): string {
    if (!Number.isFinite(rate)) return '0';
    return rate.toFixed(rate % 1 === 0 ? 0 : 3).replace(/0+$/, '').replace(/\.$/, '');
  }

  private capitalize(s: string): string {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
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
