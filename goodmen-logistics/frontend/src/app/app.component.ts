import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { OnboardingModalService } from './services/onboarding-modal.service';
import { ApiService } from './services/api.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styles: [`
    .app {
      min-height: 100vh;
    }
    .dqf-close-btn {
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 18px;
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

  constructor(
    private router: Router,
    public onboardingModal: OnboardingModalService,
    private apiService: ApiService
  ) {}

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

    if (role === 'safety') return ['dashboard', 'drivers', 'vehicles', 'hos', 'audit'].includes(tab);
    if (role === 'fleet') return ['maintenance'].includes(tab);
    if (role === 'dispatch') return ['loads', 'drivers'].includes(tab);

    if (role === 'service_advisor') {
      return ['customers', 'invoices', 'sales', 'inventory_reports'].includes(tab);
    }

    if (role === 'accounting') {
      return ['customers', 'invoices', 'sales', 'inventory_reports'].includes(tab);
    }

    if (role === 'technician') {
      return ['customers', 'parts', 'receiving', 'transfers', 'inventory_reports'].includes(tab);
    }

    if (role === 'parts_manager' || role === 'shop_manager') {
      return ['parts', 'barcodes', 'receiving', 'transfers', 'sales', 'inventory_reports'].includes(tab);
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

  closeOnboardingModal(): void {
    this.onboardingModal.close();
  }

  sendOnboardingPacket(): void {
    const m = this.onboardingModal;
    if (!m.driver) return;
    if (!m.via) {
      alert('Please select how to send the packet (SMS, Email, or Both).');
      return;
    }
    if ((m.via === 'sms' || m.via === 'both') && !m.phone) {
      alert('Phone number is required for SMS.');
      return;
    }
    if ((m.via === 'email' || m.via === 'both') && !m.email) {
      alert('Email is required for Email.');
      return;
    }

    m.setSending(true);
    const driverId = m.driver.id;

    this.apiService.createOnboardingPacket(driverId).subscribe({
      next: (packetResp: any) => {
        const packetId = packetResp.packetId;
        this.apiService
          .sendOnboardingPacket(packetId, { via: m.via, phone: m.phone, email: m.email })
          .subscribe({
            next: (sendResp: any) => {
              m.setSending(false);
              m.setResultUrl(sendResp.publicUrl || packetResp.publicUrl || null);
              alert('Onboarding packet sent successfully.');
            },
            error: () => {
              alert('Failed to send onboarding packet.');
              m.setSending(false);
            }
          });
      },
      error: () => {
        alert('Failed to create onboarding packet.');
        m.setSending(false);
      }
    });
  }
}
