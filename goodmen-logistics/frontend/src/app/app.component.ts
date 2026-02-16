import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styles: [`
    .app {
      min-height: 100vh;
    }
    main {
      padding: 20px;
    }
    .active {
      border-bottom: 2px solid white;
    }
  `]
})
export class AppComponent implements OnInit {
  title = 'Goodmen Logistics';
  userRole: string | null = null;

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
}
