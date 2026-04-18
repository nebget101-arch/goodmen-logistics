import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnChanges,
  SimpleChanges
} from '@angular/core';
import { SupplyRuleRow } from '../../../../models/location.model';
import { ApiService } from '../../../../services/api.service';

interface CounterpartOption {
  id: string;
  name: string;
  code: string | null;
}

@Component({
  selector: 'app-supply-rules-tab',
  templateUrl: './supply-rules-tab.component.html',
  styleUrls: ['./supply-rules-tab.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SupplyRulesTabComponent implements OnChanges {
  /** The location being edited. null = new location (not yet saved). */
  @Input() locationId: string | null = null;
  /** 'WAREHOUSE' or 'SHOP' — determines view direction. */
  @Input() locationType = '';

  // ── List state ────────────────────────────────────────────────────────────
  rules: SupplyRuleRow[] = [];
  counterpartLocations: CounterpartOption[] = [];
  loading = false;
  loadError = '';

  // ── Add / edit dialog state ───────────────────────────────────────────────
  showRuleDialog = false;
  editingRule: SupplyRuleRow | null = null;

  // Form fields
  selectedCounterpartId = '';
  isPrimary = false;
  autoReplenish = false;
  deliveryDays: number | null = null;
  notes = '';
  savingRule = false;
  ruleErrors: Record<string, string> = {};

  // ── Delete confirmation state ─────────────────────────────────────────────
  confirmDeleteId: string | null = null;
  deletingId: string | null = null;

  // ── Derived getters ───────────────────────────────────────────────────────

  get isWarehouse(): boolean { return this.locationType === 'WAREHOUSE'; }
  get isShop(): boolean      { return this.locationType === 'SHOP'; }

  /** The type of location the user picks from in the dropdown. */
  get counterpartType(): string { return this.isWarehouse ? 'SHOP' : 'WAREHOUSE'; }

  /** Human label for the counterpart role. */
  get counterpartLabel(): string { return this.isWarehouse ? 'Shop' : 'Warehouse'; }

  /** Heading copy depending on direction. */
  get sectionHeading(): string {
    return this.isWarehouse
      ? 'Shops This Warehouse Supplies'
      : 'Warehouses Supplying This Shop';
  }

  /** Pull the "other side" name out of a rule row. */
  getCounterpartName(rule: SupplyRuleRow): string {
    return this.isWarehouse ? rule.shop_name : rule.warehouse_name;
  }

  getCounterpartId(rule: SupplyRuleRow): string {
    return this.isWarehouse ? rule.shop_location_id : rule.warehouse_location_id;
  }

  /** Counterparts already linked — excluded from the Add dropdown. */
  get availableCounterparts(): CounterpartOption[] {
    if (this.editingRule) {
      // Include current counterpart so it shows in the (disabled) select
      return this.counterpartLocations;
    }
    const usedIds = new Set(this.rules.map(r => this.getCounterpartId(r)));
    return this.counterpartLocations.filter(l => !usedIds.has(l.id));
  }

  constructor(private api: ApiService, private cdr: ChangeDetectorRef) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['locationId'] || changes['locationType']) {
      if (this.locationId && (this.isWarehouse || this.isShop)) {
        this.loadRules();
        this.loadCounterparts();
      }
    }
  }

  // ── Data loading ──────────────────────────────────────────────────────────

  loadRules(): void {
    if (!this.locationId) return;
    this.loading = true;
    this.loadError = '';
    this.cdr.markForCheck();

    this.api.getLocationSupplyRules(this.locationId).subscribe({
      next: (resp) => {
        this.rules = resp?.data ?? [];
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.loadError = err?.error?.error || 'Failed to load supply rules';
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  loadCounterparts(): void {
    this.api.listLocations({ type: this.counterpartType, active: true }).subscribe({
      next: (resp) => {
        const all: any[] = resp?.data ?? (Array.isArray(resp) ? resp : []);
        this.counterpartLocations = all.map((l: any) => ({
          id: l.id,
          name: l.name,
          code: l.code ?? null
        }));
        this.cdr.markForCheck();
      },
      error: () => { /* silent — dropdown will show empty */ }
    });
  }

  // ── Dialog open / close ───────────────────────────────────────────────────

  openAddDialog(): void {
    this.editingRule = null;
    this.selectedCounterpartId = '';
    this.isPrimary = false;
    this.autoReplenish = false;
    this.deliveryDays = null;
    this.notes = '';
    this.ruleErrors = {};
    this.savingRule = false;
    this.showRuleDialog = true;
    this.cdr.markForCheck();
  }

  openEditDialog(rule: SupplyRuleRow): void {
    this.editingRule = rule;
    this.selectedCounterpartId = this.getCounterpartId(rule);
    this.isPrimary = rule.is_primary_supplier;
    this.autoReplenish = rule.auto_replenish;
    this.deliveryDays = rule.delivery_days;
    this.notes = rule.notes ?? '';
    this.ruleErrors = {};
    this.savingRule = false;
    this.showRuleDialog = true;
    this.cdr.markForCheck();
  }

  closeRuleDialog(): void {
    this.showRuleDialog = false;
    this.editingRule = null;
    this.ruleErrors = {};
    this.cdr.markForCheck();
  }

  onDialogBackdrop(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('srt-dialog-backdrop')) {
      this.closeRuleDialog();
    }
  }

  // ── Validation ────────────────────────────────────────────────────────────

  validateRuleForm(): boolean {
    this.ruleErrors = {};
    if (!this.editingRule && !this.selectedCounterpartId) {
      this.ruleErrors['counterpart'] = `${this.counterpartLabel} is required`;
    }
    if (this.deliveryDays !== null && this.deliveryDays !== undefined) {
      const d = Number(this.deliveryDays);
      if (!Number.isInteger(d) || d < 0 || d > 365) {
        this.ruleErrors['deliveryDays'] = 'Enter a whole number between 0 and 365';
      }
    }
    return Object.keys(this.ruleErrors).length === 0;
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async saveRule(): Promise<void> {
    if (!this.validateRuleForm()) return;
    this.savingRule = true;
    this.cdr.markForCheck();

    try {
      if (this.editingRule) {
        await this.api.updateLocationSupplyRule(this.locationId!, this.editingRule.id, {
          is_primary_supplier: this.isPrimary,
          auto_replenish:      this.autoReplenish,
          delivery_days:       this.deliveryDays,
          notes:               this.notes.trim() || null,
        }).toPromise();
      } else {
        const payload: Record<string, unknown> = {
          is_primary_supplier: this.isPrimary,
          auto_replenish:      this.autoReplenish,
          delivery_days:       this.deliveryDays,
          notes:               this.notes.trim() || null,
        };
        if (this.isWarehouse) {
          payload['warehouse_location_id'] = this.locationId;
          payload['shop_location_id']      = this.selectedCounterpartId;
        } else {
          payload['warehouse_location_id'] = this.selectedCounterpartId;
          payload['shop_location_id']      = this.locationId;
        }
        await this.api.createLocationSupplyRule(this.locationId!, payload).toPromise();
      }
      this.closeRuleDialog();
      this.loadRules();
    } catch (err: any) {
      const msg: string = err?.error?.error || 'Failed to save supply rule';
      if (msg.toLowerCase().includes('duplicate')) {
        this.ruleErrors['counterpart'] = `A supply rule for this ${this.counterpartLabel.toLowerCase()} already exists`;
      } else {
        this.ruleErrors['general'] = msg;
      }
      this.savingRule = false;
      this.cdr.markForCheck();
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  confirmDelete(rule: SupplyRuleRow): void {
    this.confirmDeleteId = rule.id;
    this.cdr.markForCheck();
  }

  cancelDelete(): void {
    this.confirmDeleteId = null;
    this.cdr.markForCheck();
  }

  async deleteRule(rule: SupplyRuleRow): Promise<void> {
    this.deletingId = rule.id;
    this.confirmDeleteId = null;
    this.cdr.markForCheck();

    try {
      await this.api.deleteLocationSupplyRule(this.locationId!, rule.id).toPromise();
      this.rules = this.rules.filter(r => r.id !== rule.id);
    } catch (err: any) {
      // Silently swallow — a toast/snackbar layer can be added later
    } finally {
      this.deletingId = null;
      this.cdr.markForCheck();
    }
  }
}
