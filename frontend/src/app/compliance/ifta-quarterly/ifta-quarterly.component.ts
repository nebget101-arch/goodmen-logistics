import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, Subscription, debounceTime } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { IftaService } from '../ifta.service';
import { IftaFuelEntry, IftaFinding, IftaJurisdictionSummary, IftaMilesEntry, IftaQuarter } from '../ifta.model';

interface TruckOption {
  id: string;
  unit: string;
  status: string;
}

interface IftaReportCards {
  total_fleet_miles: number;
  total_gallons: number;
  fleet_mpg: number;
  total_due_credit: number;
  open_warnings: number;
}

@Component({
  selector: 'app-ifta-quarterly',
  templateUrl: './ifta-quarterly.component.html',
  styleUrls: ['./ifta-quarterly.component.css']
})
export class IftaQuarterlyComponent implements OnInit, OnDestroy {
  loading = false;
  saving = false;
  error = '';
  success = '';

  quarters: IftaQuarter[] = [];
  selectedQuarterId = '';
  selectedQuarter: IftaQuarter | null = null;

  quarter = 1;
  taxYear = new Date().getFullYear();
  filingEntityName = '';
  statusBadge = 'draft';

  trucks: TruckOption[] = [];
  truckFilter = '';
  selectedTruckIds: string[] = [];

  milesRows: IftaMilesEntry[] = [];
  milesTotal = 0;
  milesOffset = 0;
  readonly pageSize = 25;

  fuelRows: IftaFuelEntry[] = [];
  fuelTotal = 0;
  fuelOffset = 0;

  findings: IftaFinding[] = [];
  summaryRows: IftaJurisdictionSummary[] = [];
  reportCards: IftaReportCards = {
    total_fleet_miles: 0,
    total_gallons: 0,
    fleet_mpg: 0,
    total_due_credit: 0,
    open_warnings: 0,
  };
  aiNarrative = '';

  newMiles: Partial<IftaMilesEntry> = {
    unit: '',
    jurisdiction: '',
    taxable_miles: 0,
    non_taxable_miles: 0,
    total_miles: 0,
    source: 'manual',
    notes: '',
  };

  newFuel: Partial<IftaFuelEntry> = {
    purchase_date: new Date().toISOString().slice(0, 10),
    unit: '',
    jurisdiction: '',
    vendor: '',
    receipt_invoice_number: '',
    gallons: 0,
    amount: 0,
    fuel_type: 'diesel',
    tax_paid: true,
    attachment_link: '',
    source: 'manual',
  };

  private readonly milesUpdate$ = new Subject<IftaMilesEntry>();
  private readonly fuelUpdate$ = new Subject<IftaFuelEntry>();
  private readonly subs = new Subscription();

  constructor(
    private ifta: IftaService,
    private api: ApiService,
  ) {}

  ngOnInit(): void {
    this.subs.add(this.milesUpdate$.pipe(debounceTime(650)).subscribe((row) => this.persistMilesRow(row)));
    this.subs.add(this.fuelUpdate$.pipe(debounceTime(650)).subscribe((row) => this.persistFuelRow(row)));

    this.loadTrucks();
    this.loadQuarters();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  get filteredTrucks(): TruckOption[] {
    const q = this.truckFilter.trim().toLowerCase();
    if (!q) return this.trucks;
    return this.trucks.filter((t) => t.unit.toLowerCase().includes(q));
  }

  get milesFrom(): number { return Math.min(this.milesOffset + 1, this.milesTotal || 0); }
  get milesTo(): number { return Math.min(this.milesOffset + this.pageSize, this.milesTotal); }
  get fuelFrom(): number { return Math.min(this.fuelOffset + 1, this.fuelTotal || 0); }
  get fuelTo(): number { return Math.min(this.fuelOffset + this.pageSize, this.fuelTotal); }

  loadTrucks(): void {
    this.api.getVehicles().subscribe({
      next: (data: any) => {
        const rows = Array.isArray(data)
          ? data
          : Array.isArray(data?.rows)
            ? data.rows
            : [];
        this.trucks = rows.map((r: any) => ({
          id: r.id,
          unit: r.unit_number || r.unit || r.name || r.license_plate || r.id,
          status: String(r.status || (r.is_active === false ? 'inactive' : 'active')).toLowerCase(),
        }));
      },
      error: () => {
        this.trucks = [];
      }
    });
  }

  loadQuarters(): void {
    this.loading = true;
    this.ifta.listQuarters().subscribe({
      next: (rows) => {
        this.quarters = rows || [];
        this.loading = false;
        if (!this.selectedQuarterId && this.quarters.length) {
          this.selectQuarter(this.quarters[0].id);
        }
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load IFTA quarters';
        this.loading = false;
      }
    });
  }

  createQuarter(): void {
    this.clearBanners();
    this.saving = true;
    this.ifta.createQuarter({
      quarter: Number(this.quarter),
      tax_year: Number(this.taxYear),
      filing_entity_name: this.filingEntityName,
      selected_truck_ids: this.selectedTruckIds,
    }).subscribe({
      next: (row) => {
        this.saving = false;
        this.success = 'IFTA quarter created.';
        this.selectedQuarterId = row.id;
        this.loadQuarters();
        this.selectQuarter(row.id);
      },
      error: (err) => {
        this.saving = false;
        this.error = err?.error?.error || 'Failed to create quarter';
      }
    });
  }

  selectQuarter(id: string): void {
    if (!id) return;
    this.selectedQuarterId = id;
    this.loading = true;
    this.ifta.getQuarter(id).subscribe({
      next: (q) => {
        this.selectedQuarter = q;
        this.quarter = Number(q.quarter);
        this.taxYear = Number(q.tax_year);
        this.filingEntityName = q.filing_entity_name || '';
        this.statusBadge = q.status;
        this.selectedTruckIds = Array.isArray(q.selected_truck_ids) ? q.selected_truck_ids : [];
        this.loading = false;
        this.loadMiles();
        this.loadFuel();
        this.loadReportPreview();
        this.loadFindings();
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load selected quarter';
        this.loading = false;
      }
    });
  }

  saveQuarterMeta(): void {
    if (!this.selectedQuarterId) return;
    this.saving = true;
    this.ifta.patchQuarter(this.selectedQuarterId, {
      filing_entity_name: this.filingEntityName,
      selected_truck_ids: this.selectedTruckIds,
    }).subscribe({
      next: (q) => {
        this.selectedQuarter = q;
        this.statusBadge = q.status;
        this.saving = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to save quarter metadata';
        this.saving = false;
      }
    });
  }

  toggleTruck(id: string, checked: boolean): void {
    if (checked) {
      if (!this.selectedTruckIds.includes(id)) this.selectedTruckIds = [...this.selectedTruckIds, id];
    } else {
      this.selectedTruckIds = this.selectedTruckIds.filter((x) => x !== id);
    }
    this.saveQuarterMeta();
  }

  loadMiles(offset = this.milesOffset): void {
    if (!this.selectedQuarterId) return;
    this.milesOffset = Math.max(0, offset);
    this.ifta.getMiles(this.selectedQuarterId, this.pageSize, this.milesOffset).subscribe({
      next: (resp) => {
        this.milesRows = resp.rows || [];
        this.milesTotal = Number(resp.total || 0);
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load mileage rows';
      }
    });
  }

  addMilesRow(): void {
    if (!this.selectedQuarterId) return;
    const payload: Partial<IftaMilesEntry> = {
      ...this.newMiles,
      unit: String(this.newMiles.unit || '').trim(),
      jurisdiction: String(this.newMiles.jurisdiction || '').trim().toUpperCase(),
      taxable_miles: Number(this.newMiles.taxable_miles || 0),
      non_taxable_miles: Number(this.newMiles.non_taxable_miles || 0),
      total_miles: Number(this.newMiles.total_miles || 0),
    };
    if (!payload.unit || !payload.jurisdiction) {
      this.error = 'Miles row requires unit and jurisdiction.';
      return;
    }

    this.ifta.createMiles(this.selectedQuarterId, payload).subscribe({
      next: () => {
        this.newMiles = { unit: '', jurisdiction: '', taxable_miles: 0, non_taxable_miles: 0, total_miles: 0, source: 'manual', notes: '' };
        this.loadMiles(0);
        this.loadReportPreview();
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to add miles row';
      }
    });
  }

  queueMilesUpdate(row: IftaMilesEntry): void {
    if (!row) return;
    this.milesUpdate$.next(row);
  }

  private persistMilesRow(row: IftaMilesEntry): void {
    if (!this.selectedQuarterId || !row?.id) return;
    const payload: Partial<IftaMilesEntry> = {
      unit: row.unit,
      jurisdiction: String(row.jurisdiction || '').toUpperCase(),
      taxable_miles: Number(row.taxable_miles || 0),
      non_taxable_miles: Number(row.non_taxable_miles || 0),
      total_miles: Number(row.total_miles || 0),
      source: row.source,
      notes: row.notes || '',
    };
    this.ifta.updateMiles(this.selectedQuarterId, row.id, payload).subscribe({
      next: () => this.loadReportPreview(),
      error: () => {}
    });
  }

  deleteMilesRow(id: string): void {
    if (!this.selectedQuarterId || !id) return;
    this.ifta.deleteMiles(this.selectedQuarterId, id).subscribe({
      next: () => {
        this.loadMiles(this.milesOffset);
        this.loadReportPreview();
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to delete miles row';
      }
    });
  }

  importMilesCsv(event: Event): void {
    if (!this.selectedQuarterId) return;
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) return;
    file.text().then((csvText) => {
      this.ifta.importMiles(this.selectedQuarterId, { csv_text: csvText, file_name: file.name }).subscribe({
        next: () => {
          this.success = 'Miles CSV imported.';
          this.loadMiles(0);
          this.loadReportPreview();
        },
        error: (err) => {
          this.error = err?.error?.error || 'Failed to import miles CSV';
        }
      });
    }).catch(() => {
      this.error = 'Failed to read miles CSV file';
    });
  }

  loadFuel(offset = this.fuelOffset): void {
    if (!this.selectedQuarterId) return;
    this.fuelOffset = Math.max(0, offset);
    this.ifta.getFuel(this.selectedQuarterId, this.pageSize, this.fuelOffset).subscribe({
      next: (resp) => {
        this.fuelRows = resp.rows || [];
        this.fuelTotal = Number(resp.total || 0);
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load fuel rows';
      }
    });
  }

  addFuelRow(): void {
    if (!this.selectedQuarterId) return;
    const payload: Partial<IftaFuelEntry> = {
      ...this.newFuel,
      purchase_date: this.newFuel.purchase_date || '',
      unit: String(this.newFuel.unit || '').trim(),
      jurisdiction: String(this.newFuel.jurisdiction || '').trim().toUpperCase(),
      gallons: Number(this.newFuel.gallons || 0),
      amount: Number(this.newFuel.amount || 0),
      fuel_type: this.newFuel.fuel_type || 'diesel',
      tax_paid: this.newFuel.tax_paid !== false,
    };

    if (!payload.purchase_date || !payload.unit || !payload.jurisdiction || Number(payload.gallons || 0) <= 0) {
      this.error = 'Fuel row requires date, unit, jurisdiction and gallons > 0.';
      return;
    }

    this.ifta.createFuel(this.selectedQuarterId, payload).subscribe({
      next: () => {
        this.newFuel = {
          purchase_date: new Date().toISOString().slice(0, 10),
          unit: '',
          jurisdiction: '',
          vendor: '',
          receipt_invoice_number: '',
          gallons: 0,
          amount: 0,
          fuel_type: 'diesel',
          tax_paid: true,
          attachment_link: '',
          source: 'manual',
        };
        this.loadFuel(0);
        this.loadReportPreview();
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to add fuel row';
      }
    });
  }

  queueFuelUpdate(row: IftaFuelEntry): void {
    if (!row) return;
    this.fuelUpdate$.next(row);
  }

  private persistFuelRow(row: IftaFuelEntry): void {
    if (!this.selectedQuarterId || !row?.id) return;
    const payload: Partial<IftaFuelEntry> = {
      purchase_date: row.purchase_date,
      unit: row.unit,
      jurisdiction: String(row.jurisdiction || '').toUpperCase(),
      vendor: row.vendor,
      receipt_invoice_number: row.receipt_invoice_number,
      gallons: Number(row.gallons || 0),
      amount: Number(row.amount || 0),
      fuel_type: row.fuel_type,
      tax_paid: !!row.tax_paid,
      attachment_link: row.attachment_link,
      source: row.source,
      notes: row.notes,
    };
    this.ifta.updateFuel(this.selectedQuarterId, row.id, payload).subscribe({
      next: () => this.loadReportPreview(),
      error: () => {}
    });
  }

  deleteFuelRow(id: string): void {
    if (!this.selectedQuarterId || !id) return;
    this.ifta.deleteFuel(this.selectedQuarterId, id).subscribe({
      next: () => {
        this.loadFuel(this.fuelOffset);
        this.loadReportPreview();
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to delete fuel row';
      }
    });
  }

  importFuelCsv(event: Event): void {
    if (!this.selectedQuarterId) return;
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) return;
    file.text().then((csvText) => {
      this.ifta.importFuel(this.selectedQuarterId, { csv_text: csvText, file_name: file.name }).subscribe({
        next: () => {
          this.success = 'Fuel CSV imported.';
          this.loadFuel(0);
          this.loadReportPreview();
        },
        error: (err) => {
          this.error = err?.error?.error || 'Failed to import fuel CSV';
        }
      });
    }).catch(() => {
      this.error = 'Failed to read fuel CSV file';
    });
  }

  runAiReview(): void {
    if (!this.selectedQuarterId) return;
    this.saving = true;
    this.ifta.runAiReview(this.selectedQuarterId).subscribe({
      next: (resp) => {
        this.saving = false;
        this.success = 'AI review completed.';
        this.aiNarrative = resp?.narrative || '';
        this.loadFindings();
        this.loadReportPreview();
        this.loadQuarterSilently();
      },
      error: (err) => {
        this.saving = false;
        this.error = err?.error?.error || 'Failed to run AI review';
      }
    });
  }

  loadFindings(): void {
    if (!this.selectedQuarterId) return;
    this.ifta.listFindings(this.selectedQuarterId).subscribe({
      next: (rows) => {
        this.findings = rows || [];
      },
      error: () => {
        this.findings = [];
      }
    });
  }

  resolveFinding(f: IftaFinding): void {
    if (!f?.id) return;
    const notes = prompt('Resolution notes', f.resolved_notes || '') || '';
    this.ifta.resolveFinding(f.id, notes).subscribe({
      next: () => {
        this.loadFindings();
        this.loadReportPreview();
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to resolve finding';
      }
    });
  }

  loadReportPreview(): void {
    if (!this.selectedQuarterId) return;
    this.ifta.reportPreview(this.selectedQuarterId).subscribe({
      next: (resp) => {
        this.summaryRows = resp.summary || [];
        const cards = resp.cards || {};
        this.reportCards = {
          total_fleet_miles: Number(cards['total_fleet_miles'] || 0),
          total_gallons: Number(cards['total_gallons'] || 0),
          fleet_mpg: Number(cards['fleet_mpg'] || 0),
          total_due_credit: Number(cards['total_due_credit'] || 0),
          open_warnings: Number(cards['open_warnings'] || 0),
        };
        this.aiNarrative = resp.ai_narrative || this.aiNarrative;
      },
      error: () => {
        this.summaryRows = [];
      }
    });
  }

  finalizeQuarter(): void {
    if (!this.selectedQuarterId) return;
    this.saving = true;
    this.ifta.finalize(this.selectedQuarterId).subscribe({
      next: () => {
        this.saving = false;
        this.success = 'Quarter finalized successfully.';
        this.loadQuarterSilently();
        this.loadReportPreview();
      },
      error: (err) => {
        this.saving = false;
        this.error = err?.error?.error || 'Finalize failed';
      }
    });
  }

  exportCsv(kind: 'miles' | 'fuel' | 'jurisdiction-summary'): void {
    if (!this.selectedQuarterId) return;
    this.ifta.exportCsv(this.selectedQuarterId, kind).subscribe({
      next: (blob) => this.downloadBlob(blob, `ifta-${kind}.csv`),
      error: (err) => {
        this.error = err?.error?.error || `Failed to export ${kind} CSV`;
      }
    });
  }

  exportPdf(): void {
    if (!this.selectedQuarterId) return;
    this.ifta.exportPdf(this.selectedQuarterId).subscribe({
      next: (blob) => this.downloadBlob(blob, 'ifta-summary.pdf'),
      error: (err) => {
        this.error = err?.error?.error || 'Failed to export PDF';
      }
    });
  }

  exportPayloadJson(): void {
    if (!this.selectedQuarterId) return;
    this.ifta.filingPayload(this.selectedQuarterId).subscribe({
      next: (payload) => {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        this.downloadBlob(blob, 'ifta-filing-payload.json');
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to export payload JSON';
      }
    });
  }

  hasStatus(status: string): boolean {
    return String(this.statusBadge || '').toLowerCase() === status;
  }

  private loadQuarterSilently(): void {
    if (!this.selectedQuarterId) return;
    this.ifta.getQuarter(this.selectedQuarterId).subscribe({
      next: (q) => {
        this.selectedQuarter = q;
        this.statusBadge = q.status;
      },
      error: () => {}
    });
  }

  private clearBanners(): void {
    this.error = '';
    this.success = '';
  }

  private downloadBlob(blob: Blob, fileName: string): void {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    window.URL.revokeObjectURL(url);
  }
}
