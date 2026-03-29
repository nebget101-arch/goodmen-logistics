import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { TollsService } from '../tolls.service';
import { ApiService } from '../../services/api.service';
import { TollAccount, TollDevice, TollDeviceAssignment } from '../tolls.model';
import { DeviceDialogComponent, DeviceDialogData } from './device-dialog/device-dialog.component';

@Component({
  selector: 'app-tolls-devices',
  templateUrl: './tolls-devices.component.html',
  styleUrls: ['./tolls-devices.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TollsDevicesComponent implements OnInit {
  rows: TollDevice[] = [];
  accounts: TollAccount[] = [];
  loading = false;
  error = '';
  successMsg = '';

  drivers: { id: string; first_name: string; last_name: string; truck_id?: string }[] = [];
  trucks: { id: string; unit_number: string; plate_number?: string }[] = [];
  assignmentMap: Record<string, TollDeviceAssignment> = {};
  driverOverrideMap: Record<string, string> = {};

  showAssignTruckDialog = false;
  assigningDevice: TollDevice | null = null;
  assignTruckForm: FormGroup;
  savingAssign = false;

  showDriverOverride = false;
  overrideDevice: TollDevice | null = null;
  selectedOverrideDriverId = '';
  savingOverride = false;

  showHistory = false;
  historyDevice: TollDevice | null = null;
  historyRows: TollDeviceAssignment[] = [];
  historyLoading = false;

  constructor(
    private tolls: TollsService,
    private api: ApiService,
    private dialog: MatDialog,
    private fb: FormBuilder,
    private cdr: ChangeDetectorRef
  ) {
    this.assignTruckForm = this.fb.group({
      truck_id: ['', Validators.required],
      plate_number: [''],
      driver_id: [''],
      notes: ['']
    });
  }

  ngOnInit(): void {
    this.loadDevices();
    this.loadAccounts();
    this.loadTrucksAndDrivers();
  }

  loadDevices(): void {
    this.loading = true;
    this.error = '';
    this.tolls.getDevices().subscribe({
      next: (rows) => {
        this.rows = rows || [];
        this.loading = false;
        if (this.rows.length > 0) {
          this.loadAssignments();
        } else {
          this.cdr.markForCheck();
        }
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load toll devices';
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  private loadAccounts(): void {
    this.tolls.getAccounts().subscribe({
      next: (accounts) => {
        this.accounts = accounts || [];
        this.cdr.markForCheck();
      },
      error: () => {
        this.accounts = [];
        this.cdr.markForCheck();
      }
    });
  }

  loadTrucksAndDrivers(): void {
    this.api.getVehicles().subscribe({
      next: (res) => {
        const raw = Array.isArray(res) ? res : (res?.trucks || res?.vehicles || []);
        this.trucks = raw.map((v: { id: string; unit_number: string; plate_number?: string }) => ({
          id: v.id,
          unit_number: v.unit_number,
          plate_number: v.plate_number
        }));
        this.cdr.markForCheck();
      },
      error: () => {
        this.trucks = [];
        this.cdr.markForCheck();
      }
    });

    this.api.getDrivers().subscribe({
      next: (res) => {
        const raw = Array.isArray(res) ? res : (res?.drivers || []);
        this.drivers = raw.map((d: { id: string; first_name: string; last_name: string; truck_id?: string }) => ({
          id: d.id,
          first_name: d.first_name,
          last_name: d.last_name,
          truck_id: d.truck_id
        }));
        this.cdr.markForCheck();
      },
      error: () => {
        this.drivers = [];
        this.cdr.markForCheck();
      }
    });
  }

  loadAssignments(): void {
    const requests = this.rows.map(device =>
      this.tolls.getDeviceAssignments(device.id).pipe(
        catchError(() => of([] as TollDeviceAssignment[]))
      )
    );

    forkJoin(requests).subscribe({
      next: (results) => {
        const map: Record<string, TollDeviceAssignment> = {};
        const overrideMap: Record<string, string> = {};
        results.forEach((assignments, idx) => {
          const active = assignments.find(a => a.status === 'active');
          if (active) {
            map[this.rows[idx].id] = active;
            if (active.driver_override_id) {
              overrideMap[this.rows[idx].id] = active.driver_override_id;
            }
          }
        });
        this.assignmentMap = map;
        this.driverOverrideMap = overrideMap;
        this.cdr.markForCheck();
      },
      error: () => {
        this.cdr.markForCheck();
      }
    });
  }

  openAddDialog(): void {
    this.openDialog();
  }

  openEditDialog(device: TollDevice): void {
    this.openDialog(device);
  }

  private openDialog(device?: TollDevice): void {
    const data: DeviceDialogData = {
      device,
      accounts: this.accounts
    };

    const dialogRef = this.dialog.open(DeviceDialogComponent, {
      width: '540px',
      maxWidth: '96vw',
      disableClose: false,
      panelClass: 'dark-dialog',
      data
    });

    dialogRef.afterClosed().subscribe((result: { saved: boolean } | undefined) => {
      if (result?.saved) {
        this.successMsg = device ? 'Device updated successfully.' : 'Device created successfully.';
        this.loadDevices();
        setTimeout(() => { this.successMsg = ''; this.cdr.markForCheck(); }, 4000);
      }
    });
  }

  openAssignTruck(device: TollDevice): void {
    this.assigningDevice = device;
    this.assignTruckForm.reset({ truck_id: '', plate_number: '', driver_id: '', notes: '' });
    this.showAssignTruckDialog = true;
  }

  onTruckSelected(truckId: string): void {
    const truck = this.trucks.find(t => t.id === truckId);
    const driver = this.drivers.find(d => d.truck_id === truckId);
    this.assignTruckForm.patchValue({
      plate_number: truck?.plate_number || '',
      driver_id: driver?.id || ''
    });
  }

  closeAssignTruck(): void {
    if (this.savingAssign) return;
    this.showAssignTruckDialog = false;
    this.assigningDevice = null;
  }

  saveAssignTruck(): void {
    if (this.assignTruckForm.invalid || !this.assigningDevice) return;
    const device = this.assigningDevice;
    const { truck_id, plate_number, driver_id, notes } = this.assignTruckForm.value as { truck_id: string; plate_number: string; driver_id: string; notes: string };
    this.savingAssign = true;
    this.tolls.assignVehicle(device.id, { truck_id, plate_number: plate_number || undefined, notes: notes || undefined }).subscribe({
      next: () => {
        if (driver_id) {
          this.tolls.assignDriver(device.id, driver_id).subscribe({
            next: () => {
              this.savingAssign = false;
              this.showAssignTruckDialog = false;
              this.assigningDevice = null;
              this.successMsg = 'Truck assigned successfully.';
              this.loadDevices();
              setTimeout(() => { this.successMsg = ''; this.cdr.markForCheck(); }, 4000);
              this.cdr.markForCheck();
            },
            error: () => {
              // vehicle assigned successfully, driver override failed — still show success
              this.savingAssign = false;
              this.showAssignTruckDialog = false;
              this.assigningDevice = null;
              this.successMsg = 'Truck assigned successfully.';
              this.loadDevices();
              setTimeout(() => { this.successMsg = ''; this.cdr.markForCheck(); }, 4000);
              this.cdr.markForCheck();
            }
          });
        } else {
          this.savingAssign = false;
          this.showAssignTruckDialog = false;
          this.assigningDevice = null;
          this.successMsg = 'Truck assigned successfully.';
          this.loadDevices();
          setTimeout(() => { this.successMsg = ''; this.cdr.markForCheck(); }, 4000);
          this.cdr.markForCheck();
        }
      },
      error: (err) => {
        this.savingAssign = false;
        this.error = err?.error?.error || 'Failed to assign truck';
        this.cdr.markForCheck();
        setTimeout(() => { this.error = ''; this.cdr.markForCheck(); }, 5000);
      }
    });
  }

  removeTruck(device: TollDevice): void {
    if (!confirm(`Remove truck assignment from device ${device.device_number_masked || device.id}?`)) return;
    this.tolls.removeVehicle(device.id).subscribe({
      next: () => {
        this.successMsg = 'Truck assignment removed.';
        this.loadDevices();
        setTimeout(() => { this.successMsg = ''; this.cdr.markForCheck(); }, 4000);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to remove truck assignment';
        this.cdr.markForCheck();
        setTimeout(() => { this.error = ''; this.cdr.markForCheck(); }, 5000);
      }
    });
  }

  openDriverOverride(device: TollDevice): void {
    this.overrideDevice = device;
    this.selectedOverrideDriverId = this.driverOverrideMap[device.id] || '';
    this.showDriverOverride = true;
  }

  closeDriverOverride(): void {
    this.showDriverOverride = false;
    this.overrideDevice = null;
  }

  saveDriverOverride(): void {
    if (!this.overrideDevice) return;
    const device = this.overrideDevice;
    this.savingOverride = true;
    this.tolls.assignDriver(device.id, this.selectedOverrideDriverId).subscribe({
      next: () => {
        this.savingOverride = false;
        this.showDriverOverride = false;
        this.overrideDevice = null;
        this.successMsg = 'Driver override saved.';
        this.loadDevices();
        setTimeout(() => { this.successMsg = ''; this.cdr.markForCheck(); }, 4000);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.savingOverride = false;
        this.error = err?.error?.error || 'Failed to save driver override';
        this.cdr.markForCheck();
        setTimeout(() => { this.error = ''; this.cdr.markForCheck(); }, 5000);
      }
    });
  }

  openHistory(device: TollDevice): void {
    this.historyDevice = device;
    this.historyLoading = true;
    this.historyRows = [];
    this.showHistory = true;
    this.tolls.getDeviceAssignments(device.id).subscribe({
      next: (rows) => {
        this.historyRows = rows || [];
        this.historyLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.historyRows = [];
        this.historyLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  closeHistory(): void {
    this.showHistory = false;
    this.historyDevice = null;
  }

  getAccountName(accountId: string): string {
    const acct = this.accounts.find((a) => a.id === accountId);
    return acct ? (acct.display_name || acct.provider_name) : accountId || '—';
  }

  truckDisplay(truckId: string): string {
    if (!truckId) return '';
    const t = this.trucks.find(v => v.id === truckId);
    return t ? t.unit_number : truckId;
  }

  driverDisplay(driverId: string): string {
    if (!driverId) return '';
    const d = this.drivers.find(dr => dr.id === driverId);
    return d ? `${d.first_name} ${d.last_name}` : driverId;
  }
}
