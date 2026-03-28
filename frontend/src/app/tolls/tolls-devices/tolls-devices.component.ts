import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TollsService } from '../tolls.service';
import { TollAccount, TollDevice } from '../tolls.model';
import { DeviceDialogComponent, DeviceDialogData } from './device-dialog/device-dialog.component';

@Component({
  selector: 'app-tolls-devices',
  templateUrl: './tolls-devices.component.html',
  styleUrls: ['./tolls-devices.component.css']
})
export class TollsDevicesComponent implements OnInit {
  rows: TollDevice[] = [];
  accounts: TollAccount[] = [];
  loading = false;
  error = '';
  successMsg = '';

  constructor(
    private tolls: TollsService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.loadDevices();
    this.loadAccounts();
  }

  loadDevices(): void {
    this.loading = true;
    this.error = '';
    this.tolls.getDevices().subscribe({
      next: (rows) => {
        this.rows = rows || [];
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load toll devices';
        this.loading = false;
      }
    });
  }

  private loadAccounts(): void {
    this.tolls.getAccounts().subscribe({
      next: (accounts) => {
        this.accounts = accounts || [];
      },
      error: () => {
        this.accounts = [];
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
        setTimeout(() => { this.successMsg = ''; }, 4000);
      }
    });
  }

  getAccountName(accountId: string): string {
    const acct = this.accounts.find((a) => a.id === accountId);
    return acct ? (acct.display_name || acct.provider_name) : accountId || '—';
  }
}
