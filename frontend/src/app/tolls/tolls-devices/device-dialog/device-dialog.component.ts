import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Observable, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, map, startWith } from 'rxjs/operators';
import { TollsService } from '../../tolls.service';
import { TollAccount, TollDevice } from '../../tolls.model';
import { ApiService } from '../../../services/api.service';

export interface DeviceDialogData {
  device?: TollDevice;
  accounts: TollAccount[];
}

interface EquipmentOption {
  id: string;
  label: string;
  unitNumber: string;
  plateNumber: string;
}

interface DriverOption {
  id: string;
  label: string;
  truckId?: string;
  truckUnitNumber?: string;
  truckPlateNumber?: string;
  trailerId?: string;
  trailerUnitNumber?: string;
  trailerPlateNumber?: string;
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

  driverControl = new FormControl<string>('');
  truckControl = new FormControl<string>('');
  trailerControl = new FormControl<string>('');
  filteredDrivers$: Observable<DriverOption[]> = of([]);
  filteredTrucks$: Observable<EquipmentOption[]> = of([]);
  filteredTrailers$: Observable<EquipmentOption[]> = of([]);

  private allTrucks: EquipmentOption[] = [];
  private allTrailers: EquipmentOption[] = [];
  private allDrivers: DriverOption[] = [];

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
      truck_id: [this.data.device?.truck_id || ''],
      driver_id: [this.data.device?.driver_id || ''],
      trailer_id: [this.data.device?.trailer_id || ''],
      truck_plate_number: [this.data.device?.plate_number || ''],
      trailer_plate_number: [''],
      effective_start_date: [this.data.device?.effective_start_date || ''],
      effective_end_date: [this.data.device?.effective_end_date || ''],
      status: [this.data.device?.status || 'active']
    });

    this.loadVehiclesAndDrivers();
    this.setupDriverAutocomplete();
    this.setupTruckAutocomplete();
    this.setupTrailerAutocomplete();
  }

  private loadVehiclesAndDrivers(): void {
    this.api.getVehicles().subscribe({
      next: (vehicles: Array<{ id: string; unit_number?: string; vin?: string; license_plate?: string; vehicle_type?: string }>) => {
        const items = (vehicles || []).map((v) => this.toEquipmentOption(v));
        this.allTrucks = items.filter((v, index) => {
          const raw = vehicles[index] || {};
          return String(raw.vehicle_type || '').toLowerCase() !== 'trailer';
        });
        this.allTrailers = items.filter((v, index) => {
          const raw = vehicles[index] || {};
          return String(raw.vehicle_type || '').toLowerCase() === 'trailer';
        });
        this.setupTruckAutocomplete();
        this.setupTrailerAutocomplete();
        this.patchEquipmentFromDevice();
      },
      error: () => {
        this.allTrucks = [];
        this.allTrailers = [];
        this.setupTruckAutocomplete();
        this.setupTrailerAutocomplete();
      }
    });

    this.api.getDrivers().subscribe({
      next: (drivers: Array<{
        id: string;
        firstName?: string;
        lastName?: string;
        driverName?: string;
        truckId?: string;
        truckUnitNumber?: string;
        truckPlateNumber?: string;
        trailerId?: string;
        trailerUnitNumber?: string;
        trailerPlateNumber?: string;
        first_name?: string;
        last_name?: string;
        driver_name?: string;
        truck_id?: string;
        truck_unit_number?: string;
        truck_plate_number?: string;
        trailer_id?: string;
        trailer_unit_number?: string;
        trailer_plate_number?: string;
      }>) => {
        this.allDrivers = (drivers || []).map((d) => ({
          id: String(d.id),
          label: d.driverName
            || d.driver_name
            || [d.firstName, d.lastName].filter(Boolean).join(' ')
            || [d.first_name, d.last_name].filter(Boolean).join(' ')
            || String(d.id),
          truckId: d.truckId ? String(d.truckId) : (d.truck_id ? String(d.truck_id) : undefined),
          truckUnitNumber: d.truckUnitNumber || d.truck_unit_number || '',
          truckPlateNumber: d.truckPlateNumber || d.truck_plate_number || '',
          trailerId: d.trailerId ? String(d.trailerId) : (d.trailer_id ? String(d.trailer_id) : undefined),
          trailerUnitNumber: d.trailerUnitNumber || d.trailer_unit_number || '',
          trailerPlateNumber: d.trailerPlateNumber || d.trailer_plate_number || ''
        }));
        this.setupDriverAutocomplete();
        this.patchDriverFromDevice();
      },
      error: () => {
        this.allDrivers = [];
        this.setupDriverAutocomplete();
      }
    });
  }

  private toEquipmentOption(vehicle: { id: string; unit_number?: string; vin?: string; license_plate?: string }): EquipmentOption {
    const unitNumber = vehicle.unit_number || vehicle.vin || String(vehicle.id);
    const plateNumber = vehicle.license_plate || '';
    return {
      id: String(vehicle.id),
      unitNumber,
      plateNumber,
      label: plateNumber ? `${unitNumber} · ${plateNumber}` : unitNumber
    };
  }

  private setupTruckAutocomplete(): void {
    this.filteredTrucks$ = this.truckControl.valueChanges.pipe(
      startWith(this.truckControl.value || ''),
      debounceTime(200),
      distinctUntilChanged(),
      map((val) => this.filterList(this.allTrucks, val || ''))
    );
  }

  private setupTrailerAutocomplete(): void {
    this.filteredTrailers$ = this.trailerControl.valueChanges.pipe(
      startWith(this.trailerControl.value || ''),
      debounceTime(200),
      distinctUntilChanged(),
      map((val) => this.filterList(this.allTrailers, val || ''))
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

  private filterList<T extends { id: string; label: string }>(
    items: T[],
    query: string
  ): T[] {
    const lower = (query || '').toLowerCase().trim();
    if (!lower) return items.slice(0, 50);
    return items.filter((i) => i.label.toLowerCase().includes(lower)).slice(0, 50);
  }

  onTruckSelected(truckId: string): void {
    const truck = this.allTrucks.find((t) => t.id === truckId);
    this.form.patchValue({
      truck_id: truckId,
      truck_plate_number: truck?.plateNumber || this.form.value.truck_plate_number || ''
    });
    this.truckControl.setValue(truck?.unitNumber || '');
  }

  onDriverSelected(driverId: string): void {
    const driver = this.allDrivers.find((d) => d.id === driverId);
    this.form.patchValue({
      driver_id: driverId,
      truck_id: driver?.truckId || '',
      trailer_id: driver?.trailerId || '',
      truck_plate_number: driver?.truckPlateNumber || '',
      trailer_plate_number: driver?.trailerPlateNumber || ''
    });
    this.driverControl.setValue(driver?.label || '');
    this.truckControl.setValue(driver?.truckUnitNumber || '');
    this.trailerControl.setValue(driver?.trailerUnitNumber || '');
  }

  onTrailerSelected(trailerId: string): void {
    const trailer = this.allTrailers.find((t) => t.id === trailerId);
    this.form.patchValue({
      trailer_id: trailerId,
      trailer_plate_number: trailer?.plateNumber || this.form.value.trailer_plate_number || ''
    });
    this.trailerControl.setValue(trailer?.unitNumber || '');
  }

  clearDriverSelection(): void {
    this.form.patchValue({ driver_id: '' });
  }

  clearTruckSelection(): void {
    this.form.patchValue({ truck_id: '' });
  }

  clearTrailerSelection(): void {
    this.form.patchValue({ trailer_id: '' });
  }

  private resolveEquipmentByInput(items: EquipmentOption[], unitValue: string, plateValue: string): EquipmentOption | undefined {
    const normalizedUnit = (unitValue || '').trim().toLowerCase();
    const normalizedPlate = (plateValue || '').trim().toLowerCase();
    if (!normalizedUnit && !normalizedPlate) return undefined;

    return items.find((item) => {
      const itemUnit = (item.unitNumber || '').trim().toLowerCase();
      const itemPlate = (item.plateNumber || '').trim().toLowerCase();
      return (normalizedUnit && itemUnit === normalizedUnit)
        || (normalizedPlate && itemPlate === normalizedPlate);
    });
  }

  private syncEquipmentIdsFromManualInputs(): void {
    const truck = this.resolveEquipmentByInput(
      this.allTrucks,
      this.truckControl.value || '',
      this.form.value.truck_plate_number || ''
    );
    const trailer = this.resolveEquipmentByInput(
      this.allTrailers,
      this.trailerControl.value || '',
      this.form.value.trailer_plate_number || ''
    );

    this.form.patchValue({
      truck_id: truck?.id || '',
      trailer_id: trailer?.id || ''
    });
  }

  private patchDriverFromDevice(): void {
    const driverId = this.data.device?.driver_id ? String(this.data.device.driver_id) : '';
    if (!driverId) return;
    const driver = this.allDrivers.find((d) => d.id === driverId);
    this.driverControl.setValue(driver?.label || '');
    if (!this.data.device?.truck_id && driver?.truckId) {
      this.form.patchValue({ truck_id: driver.truckId });
      this.truckControl.setValue(driver.truckUnitNumber || '');
      this.form.patchValue({ truck_plate_number: this.form.value.truck_plate_number || driver.truckPlateNumber || '' });
    }
    if (!this.data.device?.trailer_id && driver?.trailerId) {
      this.form.patchValue({ trailer_id: driver.trailerId });
      this.trailerControl.setValue(driver.trailerUnitNumber || '');
      this.form.patchValue({ trailer_plate_number: driver.trailerPlateNumber || '' });
    }
  }

  private patchEquipmentFromDevice(): void {
    const truckId = this.data.device?.truck_id ? String(this.data.device.truck_id) : '';
    if (truckId) {
      const truck = this.allTrucks.find((t) => t.id === truckId);
      this.truckControl.setValue(truck?.unitNumber || '');
      if (!this.form.value.truck_plate_number) {
        this.form.patchValue({ truck_plate_number: truck?.plateNumber || '' });
      }
    }

    const trailerId = this.data.device?.trailer_id ? String(this.data.device.trailer_id) : '';
    if (trailerId) {
      const trailer = this.allTrailers.find((t) => t.id === trailerId);
      this.trailerControl.setValue(trailer?.unitNumber || '');
      this.form.patchValue({ trailer_plate_number: trailer?.plateNumber || '' });
    }
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

    this.syncEquipmentIdsFromManualInputs();

    this.saving = true;
    this.errorMsg = '';

    const payload: Partial<TollDevice> = {
      toll_account_id: this.form.value.toll_account_id,
      plate_number: this.form.value.truck_plate_number || undefined,
      truck_id: this.form.value.truck_id || undefined,
      trailer_id: this.form.value.trailer_id || undefined,
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
