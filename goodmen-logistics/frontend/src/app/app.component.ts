import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styles: [`
    .app {
      min-height: 100vh;
    }
  `]
})
export class AppComponent implements OnInit {
  title = 'Goodmen Logistics';
  userRole: string | null = null;
  equipmentExpanded = true;
  safetyExpanded = true;
  fleetExpanded = true;
  accountingExpanded = true;
  inventoryExpanded = true;
  sidebarOpen = false;

  constructor(private router: Router) {}

  isLoggedIn(): boolean {
    return !!localStorage.getItem('token');
  }

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    this.router.navigate(['/login']);
    this.userRole = null;
  }

  getRole(): string | null {
    return localStorage.getItem('role');
  }

  canSee(tab: string): boolean {
    const role = this.getRole();
    if (!role) return false;
    if (role === 'admin') return true;
    if (role === 'safety') return ['dashboard','drivers', 'vehicles', 'hos', 'audit'].includes(tab);
    if (role === 'fleet') return ['maintenance'].includes(tab);
    if (role === 'dispatch') return ['loads'].includes(tab);
    if (role === 'service_advisor') return ['customers', 'invoices'].includes(tab);
    if (role === 'accounting') return ['customers', 'invoices'].includes(tab);
    if (role === 'technician') return ['customers', 'parts'].includes(tab);
    if (role === 'parts_manager' || role === 'shop_manager' || role === 'technician') {
      return ['parts'].includes(tab);
    }
    return false;
  }

  ngOnInit(): void {
    this.userRole = this.getRole();
  }

  toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen;
  }

  closeSidebar(): void {
    this.sidebarOpen = false;
  }

  onSidebarNavClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    // Close the sidebar on mobile when a nav link is clicked.
    if (target.closest('a')) {
      this.closeSidebar();
    }
  }

  toggleEquipment(): void {
    this.equipmentExpanded = !this.equipmentExpanded;
  }

  toggleSafety(): void {
    this.safetyExpanded = !this.safetyExpanded;
  }

  toggleFleet(): void {
    this.fleetExpanded = !this.fleetExpanded;
  }

  toggleAccounting(): void {
    this.accountingExpanded = !this.accountingExpanded;
  }

  toggleInventory(): void {
    this.inventoryExpanded = !this.inventoryExpanded;
  }
}
