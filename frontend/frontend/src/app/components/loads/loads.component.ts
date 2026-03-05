  // ...existing code...
import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { Load } from '../../models/load.model';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-loads',
  templateUrl: './loads.component.html',
  styleUrls: ['./loads.component.css']
})
export class LoadsComponent implements OnInit {
  loads: Load[] = [];
  loading = true;

  showDetailsModal = false;
  selectedLoad: Load | null = null;

  showCreateModal = false;
  showEditModal = false;
  newLoad: Partial<Load> = {};
  editLoad: Load | null = null;

  drivers: any[] = [];
  driverSearch: string = '';

  get filteredDrivers() {
    if (!this.driverSearch) return this.drivers;
    return this.drivers.filter(d =>
      (d.firstName + ' ' + d.lastName).toLowerCase().includes(this.driverSearch.toLowerCase())
    );
  }

  constructor(private apiService: ApiService, private http: HttpClient) { }

  // ZIP code lookup for pickup in edit modal
  lookupEditPickupZip() {
    if (!this.editLoad?.pickupZip) return;
    this.http.get<any>(`https://api.zippopotam.us/us/${this.editLoad.pickupZip}`).subscribe({
      next: (data) => {
        this.editLoad!.pickupCity = data.places[0]['place name'];
        this.editLoad!.pickupState = data.places[0]['state abbreviation'];
      },
      error: () => {}
    });
  }

  // ZIP code lookup for delivery in edit modal
  lookupEditDeliveryZip() {
    if (!this.editLoad?.deliveryZip) return;
    this.http.get<any>(`https://api.zippopotam.us/us/${this.editLoad.deliveryZip}`).subscribe({
      next: (data) => {
        this.editLoad!.deliveryCity = data.places[0]['place name'];
        this.editLoad!.deliveryState = data.places[0]['state abbreviation'];
      },
      error: () => {}
    });
  }

  ngOnInit(): void {
    this.loadLoads();
    this.apiService.getDrivers().subscribe({
      next: (data) => {
        this.drivers = data;
      },
      error: (err) => {
        this.drivers = [];
      }
    });
  }
  
  // ZIP code lookup for pickup
  lookupPickupZip() {
    if (!this.newLoad.pickupZip) return;
    this.http.get<any>(`https://api.zippopotam.us/us/${this.newLoad.pickupZip}`).subscribe({
      next: (data) => {
        this.newLoad.pickupCity = data.places[0]['place name'];
        this.newLoad.pickupState = data.places[0]['state abbreviation'];
      },
      error: () => {}
    });
  }
  
  // ZIP code lookup for delivery
  lookupDeliveryZip() {
    if (!this.newLoad.deliveryZip) return;
    this.http.get<any>(`https://api.zippopotam.us/us/${this.newLoad.deliveryZip}`).subscribe({
      next: (data) => {
        this.newLoad.deliveryCity = data.places[0]['place name'];
        this.newLoad.deliveryState = data.places[0]['state abbreviation'];
      },
      error: () => {}
    });
  }

  loadLoads(): void {
    this.apiService.getLoads().subscribe({
      next: (data) => {
        this.loads = data;
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading loads:', error);
        this.loading = false;
      }
    });
  }

  getStatusBadge(status: string): string {
    if (status === 'completed') return 'badge-success';
    if (status === 'in-transit') return 'badge-info';
    if (status === 'pending') return 'badge-warning';
    return 'badge-danger';
  }

  openDetails(load: Load) {
    this.selectedLoad = load;
    this.showDetailsModal = true;
  }

  closeDetails() {
    this.showDetailsModal = false;
    this.selectedLoad = null;
  }

  openCreateModal() {
    this.newLoad = {};
    this.showCreateModal = true;
  }

  closeCreateModal() {
    this.showCreateModal = false;
    this.newLoad = {};
  }

  createLoad() {
    this.apiService.createLoad(this.newLoad).subscribe({
      next: (created) => {
        this.loads.push(created);
        this.closeCreateModal();
      },
      error: (err) => {
        alert('Failed to create load');
      }
    });
  }

  openEditModal(load: Load) {
    this.editLoad = { ...load };
    this.showEditModal = true;
  }

  closeEditModal() {
    this.showEditModal = false;
    this.editLoad = null;
  }

  updateLoad() {
    if (!this.editLoad) return;
    this.apiService.updateLoad(this.editLoad.id, this.editLoad).subscribe({
      next: (updated) => {
        const idx = this.loads.findIndex(l => l.id === updated.id);
        if (idx !== -1) this.loads[idx] = updated;
        this.closeEditModal();
      },
      error: (err) => {
        alert('Failed to update load');
      }
    });
  }
}
