import { Component, OnInit } from '@angular/core';
import { TollsService } from '../tolls.service';
import { TollDevice } from '../tolls.model';

@Component({
  selector: 'app-tolls-devices',
  templateUrl: './tolls-devices.component.html',
  styleUrls: ['./tolls-devices.component.css']
})
export class TollsDevicesComponent implements OnInit {
  rows: TollDevice[] = [];
  loading = false;
  error = '';

  constructor(private tolls: TollsService) {}

  ngOnInit(): void {
    this.loading = true;
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
}
