import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { Observable, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, map, startWith } from 'rxjs/operators';
import { TollsService } from '../../tolls.service';
import { TollTransaction } from '../../tolls.model';
import { ApiService } from '../../../services/api.service';

@Component({
  selector: 'app-manual-toll-dialog',
  templateUrl: './manual-toll-dialog.component.html',
  styleUrls: ['./manual-toll-dialog.component.scss']
})
export class ManualTollDialogComponent implements OnInit {
  form!: FormGroup;
  saving = false;
  errorMsg = '';

  truckControl = new FormControl<string>('');
  driverControl = new FormControl<string>('');
  filteredTrucks$: Observable<Array<{ id: string; label: string }>> = of([]);
  filteredDrivers$: Observable<Array<{ id: string; label: string }>> = of([]);

  private allTrucks: Array<{ id: string; label: string }> = [];
  private allDrivers: Array<{ id: string; label: string }> = [];

  constructor(
    private fb: FormBuilder,
    private tolls: TollsService,
    private api: ApiService,
    private dialogRef: MatDialogRef<ManualTollDialogComponent>
  ) {}

  ngOnInit(): void {
    this.form = this.fb.group({
      transaction_date: ['', Validators.required],
      provider_name: [''],
      plaza_name: [''],
      entry_location: [''],
      exit_location: [''],
      city: [''],
      state: [''],
      amount: [null, [Validators.required, Validators.min(0)]],
      truck_id: [''],
      driver_id: [''],
      load_number: [''],
      notes: ['']
    });

    this.loadVehiclesAndDrivers();
  }

  private loadVehiclesAndDrivers(): void {
    this.api.getVehicles().subscribe({
      next: (vehicles: Array<{ id: string; unit_number?: string; vin?: string }>) => {
        this.allTrucks = (vehicles || []).map((v) => ({
          id: String(v.id),
          label: v.unit_number || v.vin || String(v.id)
        }));
        this.setupTruckAutocomplete();
      },
      error: () => {
        this.allTrucks = [];
        this.setupTruckAutocomplete();
      }
    });

    this.api.getDrivers().subscribe({
      next: (drivers: Array<{ id: string; first_name?: string; last_name?: string }>) => {
        this.allDrivers = (drivers || []).map((d) => ({
          id: String(d.id),
          label: [d.first_name, d.last_name].filter(Boolean).join(' ') || String(d.id)
        }));
        this.setupDriverAutocomplete();
      },
      error: () => {
        this.allDrivers = [];
        this.setupDriverAutocomplete();
      }
    });
  }

  private setupTruckAutocomplete(): void {
    this.filteredTrucks$ = this.truckControl.valueChanges.pipe(
      startWith(this.truckControl.value || ''),
      debounceTime(200),
      distinctUntilChanged(),
      map((val) => this.filterList(this.allTrucks, val || ''))
    );
  }

  private setupDriverAutocomplete(): void {
    this.filteredDrivers$ = this.driverControl.valueChanges.pipe(
      startWith(this.driverControl.value || ''),
      debounceTime(200),
      distinctUntilChanged(),
      map((val) => this.filterList(this.allDrivers, val || ''))
    );
  }

  private filterList(
    items: Array<{ id: string; label: string }>,
    query: string
  ): Array<{ id: string; label: string }> {
    const lower = (query || '').toLowerCase().trim();
    if (!lower) return items.slice(0, 50);
    return items.filter((i) => i.label.toLowerCase().includes(lower)).slice(0, 50);
  }

  onTruckSelected(truckId: string): void {
    this.form.patchValue({ truck_id: truckId });
  }

  onDriverSelected(driverId: string): void {
    this.form.patchValue({ driver_id: driverId });
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving = true;
    this.errorMsg = '';

    const v = this.form.value;
    const payload: Partial<TollTransaction> = {
      transaction_date: v.transaction_date
        ? new Date(v.transaction_date).toISOString()
        : undefined,
      provider_name: v.provider_name || undefined,
      plaza_name: v.plaza_name || undefined,
      entry_location: v.entry_location || undefined,
      exit_location: v.exit_location || undefined,
      city: v.city || undefined,
      state: v.state || undefined,
      amount: v.amount != null ? Number(v.amount) : undefined,
      truck_id: v.truck_id || undefined,
      driver_id: v.driver_id || undefined,
      load_number: v.load_number || undefined,
      notes: v.notes || undefined,
      source: 'manual'
    };

    this.tolls.createTransaction(payload).subscribe({
      next: (result) => {
        this.saving = false;
        this.dialogRef.close({ saved: true, transaction: result });
      },
      error: (err) => {
        this.saving = false;
        this.errorMsg = err?.error?.error || err?.message || 'Failed to save transaction.';
      }
    });
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
