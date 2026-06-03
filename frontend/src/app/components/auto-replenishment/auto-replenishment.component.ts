import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../services/api.service';

/** Flat row rendered in the replenishment table. */
interface ReplenishmentRow {
  shopId: string;
  shopName: string;
  partId: string;
  partName: string;
  partSku: string;
  currentQty: number;
  minStockLevel: number;
  shortage: number;
  suggestedWarehouseId: string;
  suggestedWarehouseName: string;
  deliveryDays: number | null;
}

@Component({
  selector: 'app-auto-replenishment',
  templateUrl: './auto-replenishment.component.html',
  styleUrls: ['./auto-replenishment.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AutoReplenishmentComponent implements OnInit {
  loading = false;
  error = '';

  /** All locations from API. */
  allLocations: Record<string, string>[] = [];

  /** Only shop-type locations (for the dropdown filter). */
  shopLocations: Record<string, string>[] = [];

  /** Full computed replenishment list (unfiltered). */
  private allRows: ReplenishmentRow[] = [];

  /** Filtered rows displayed in the table. */
  rows: ReplenishmentRow[] = [];

  /** Search term (part name or SKU). */
  searchTerm = '';

  /** Selected shop id for the location filter. */
  selectedShopId = '';

  // ── Summary stats ────────────────────────────────────────────────────────
  totalItemsNeeding = 0;
  uniqueShopsAffected = 0;
  estimatedTransfers = 0;

  constructor(
    private api: ApiService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadData();
  }

  // ── Data Loading ─────────────────────────────────────────────────────────

  private loadData(): void {
    this.loading = true;
    this.error = '';
    this.cdr.markForCheck();

    this.api.getLocations().subscribe({
      next: (res: Record<string, unknown>) => {
        this.allLocations = ((res as Record<string, unknown>)?.['data'] || res || []) as Record<string, string>[];
        this.shopLocations = this.allLocations.filter(
          (l) => (l['type'] || '').toString().toLowerCase() === 'shop'
        );

        if (this.shopLocations.length === 0) {
          this.loading = false;
          this.allRows = [];
          this.applyFilters();
          this.cdr.markForCheck();
          return;
        }

        this.loadInventoryAndRules();
      },
      error: (err: Record<string, unknown>) => {
        this.error = ((err?.['error'] as Record<string, unknown>)?.['error'] as string) || (err?.['message'] as string) || 'Failed to load locations';
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  private loadInventoryAndRules(): void {
    // Build parallel requests: for each shop, fetch inventory + supply rules
    const inventoryCalls = this.shopLocations.map((shop) =>
      this.api.getInventory(shop['id'])
    );
    const supplyCalls = this.shopLocations.map((shop) =>
      this.api.getLocationSupplyRules(shop['id'])
    );

    forkJoin([...inventoryCalls, ...supplyCalls]).subscribe({
      next: (results: unknown[]) => {
        const shopCount = this.shopLocations.length;
        const inventoryResults = results.slice(0, shopCount);
        const supplyResults = results.slice(shopCount);

        // Build a lookup: locationId -> locationName for warehouses
        const locationNameMap: Record<string, string> = {};
        for (const loc of this.allLocations) {
          locationNameMap[loc['id']] = loc['name'] || loc['id'];
        }

        const rows: ReplenishmentRow[] = [];

        for (let i = 0; i < shopCount; i++) {
          const shop = this.shopLocations[i];
          const shopId = shop['id'];
          const shopName = shop['name'] || shopId;

          const invRes = inventoryResults[i] as Record<string, unknown>;
          const inventoryItems = ((invRes?.['data'] || invRes || []) as Record<string, unknown>[]);

          const supplyRes = supplyResults[i] as Record<string, unknown>;
          const supplyRules = ((supplyRes?.['data'] || supplyRes || []) as Record<string, unknown>[]);

          // Build supply rule lookup: find primary supplier warehouse for this shop
          // A supply rule has supplier_location_id (the warehouse) and consumer_location_id (the shop)
          const primaryRule = supplyRules.find((r) => (r['is_primary'] as boolean) === true) || supplyRules[0];

          for (const item of inventoryItems) {
            const onHand = Number(item['on_hand_qty'] || 0);
            const minStock = Number(item['min_stock_level'] || item['reorder_level'] || 0);

            if (minStock > 0 && onHand < minStock) {
              const shortage = minStock - onHand;

              let warehouseId = '';
              let warehouseName = '';
              let deliveryDays: number | null = null;

              if (primaryRule) {
                warehouseId = (primaryRule['supplier_location_id'] as string) || '';
                warehouseName = warehouseId ? (locationNameMap[warehouseId] || warehouseId) : '';
                deliveryDays = primaryRule['delivery_days'] != null ? Number(primaryRule['delivery_days']) : null;
              }

              rows.push({
                shopId,
                shopName,
                partId: (item['part_id'] as string) || (item['id'] as string) || '',
                partName: (item['name'] as string) || '',
                partSku: (item['sku'] as string) || '',
                currentQty: onHand,
                minStockLevel: minStock,
                shortage,
                suggestedWarehouseId: warehouseId,
                suggestedWarehouseName: warehouseName,
                deliveryDays
              });
            }
          }
        }

        this.allRows = rows;
        this.applyFilters();
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err: Record<string, unknown>) => {
        this.error = ((err?.['error'] as Record<string, unknown>)?.['error'] as string) || (err?.['message'] as string) || 'Failed to load inventory data';
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  // ── Filtering ────────────────────────────────────────────────────────────

  applyFilters(): void {
    let filtered = this.allRows;

    if (this.selectedShopId) {
      filtered = filtered.filter((r) => r.shopId === this.selectedShopId);
    }

    const term = (this.searchTerm || '').trim().toLowerCase();
    if (term) {
      filtered = filtered.filter(
        (r) =>
          r.partName.toLowerCase().includes(term) ||
          r.partSku.toLowerCase().includes(term)
      );
    }

    this.rows = filtered;
    this.computeStats();
    this.cdr.markForCheck();
  }

  private computeStats(): void {
    this.totalItemsNeeding = this.rows.length;
    const shopIds = new Set(this.rows.map((r) => r.shopId));
    this.uniqueShopsAffected = shopIds.size;
    // Estimated transfers = rows that have a suggested warehouse
    this.estimatedTransfers = this.rows.filter((r) => !!r.suggestedWarehouseId).length;
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  createTransfer(row: ReplenishmentRow): void {
    this.router.navigate(['/inventory-transfers'], {
      queryParams: {
        source: row.suggestedWarehouseId,
        destination: row.shopId,
        partId: row.partId,
        qty: row.shortage
      }
    });
  }

  /** trackBy for *ngFor performance. */
  trackByRow(_index: number, row: ReplenishmentRow): string {
    return row.shopId + '-' + row.partId;
  }
}
