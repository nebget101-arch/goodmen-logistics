import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Observable, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, map, startWith, switchMap } from 'rxjs/operators';
import { TollsService } from '../../tolls.service';
import { TollAccount, TollDevice } from '../../tolls.model';
import { ApiService } from '../../../services/api.service';

export interface DeviceDialogData {
  device?: TollDevice;
  accounts: TollAccount[];
}

@Component({
  selector: 'app-device-dialog',
  templateUrl: './device-dialog.component.html',
  styleUrls: ['./device-dialog.component.scss']
})
export class DeviceDialogComponent implements OnInit {
  form!: FormGroup;
  saving = false;
  errorMsg = '';
  isEdit = false;

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
    private dialogRef: MatDialogRef<DeviceDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: DeviceDialogData
  ) {}

  ngOnInit(): void {
    this.isEdit = !!this.data.device;

    this.form = this.fb.group({
      toll_account_id: [this.data.device?.toll_account_id || '', Validators.required],
      device_number: [this.data.device?.device_number_masked || ''],
      plate_number: [this.data.device?.plate_number || ''],
      truck_id: [this.data.device?.truck_id || ''],
      driver_id: [this.data.device?.driver_id || ''],
      effective_start_date: [this.data.device?.effective_start_date || ''],
      effective_end_date: [this.data.device?.effective_end_date || ''],
      status: [this.data.device?.status || 'active']
    });

    this.truckControl.setValue(this.data.device?.truck_id || '');
    this.driverControl.setValue(this.data.device?.driver_id || '');

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

  displayTruck(id: string): string {
    if (!id) return '';
    const found = this.allTrucks.find((t) => t.id === id);
    return found ? found.label : id;
  }

  displayDriver(id: string): string {
    if (!id) return '';
    const found = this.allDrivers.find((d) => d.id === id);
    return found ? found.label : id;
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving = true;
    this.errorMsg = '';

    const payload: Partial<TollDevice> = {
      toll_account_id: this.form.value.toll_account_id,
      plate_number: this.form.value.plate_number || undefined,
      truck_id: this.form.value.truck_id || undefined,
      driver_id: this.form.value.driver_id || undefined,
      effective_start_date: this.form.value.effective_start_date
        ? new Date(this.form.value.effective_start_date).toISOString()
        : undefined,
      effective_end_date: this.form.value.effective_end_date
        ? new Date(this.form.value.effective_end_date).toISOString()
        : undefined,
      status: this.form.value.status
    };

    // Only send device_number on create (cannot be changed on edit for masked fields)
    if (!this.isEdit && this.form.value.device_number) {
      (payload as Record<string, unknown>)['device_number'] = this.form.value.device_number;
    }

    const request$ = this.isEdit
      ? this.tolls.updateDevice(this.data.device!.id, payload)
      : this.tolls.createDevice(payload);

    request$.subscribe({
      next: (result) => {
        this.saving = false;
        this.dialogRef.close({ saved: true, device: result });
      },
      error: (err) => {
        this.saving = false;
        this.errorMsg = err?.error?.error || err?.message || 'Failed to save device.';
      }
    });
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
