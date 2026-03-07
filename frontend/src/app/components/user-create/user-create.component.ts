import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AccessControlService } from '../../services/access-control.service';
import { RBAC_ROLES } from '../../config/rbac-roles.config';

@Component({
  selector: 'app-user-create',
  templateUrl: './user-create.component.html',
  styleUrls: ['./user-create.component.css']
})
export class UserCreateComponent implements OnInit {
  firstName = '';
  lastName = '';
  email = '';
  username = '';
  password = '';
  roles: string[] = ['dispatcher'];
  selectedLocationIds: string[] = [];
  allLocations: { id: string; name: string }[] = [];
  message = '';
  error = '';
  creating = false;

  readonly rbacRoles = RBAC_ROLES;

  constructor(
    private api: ApiService,
    private router: Router,
    private access: AccessControlService
  ) {}

  get generatedUsername(): string {
    const first = this.firstName.trim().toLowerCase();
    const last = this.lastName.trim().toLowerCase();
    if (!first || !last) return '';
    return `${first}.${last}`;
  }

  /** Locations filtered to admin's allowed set; empty = all. */
  get filteredLocations(): { id: string; name: string }[] {
    return this.access.getFilteredLocations(this.allLocations);
  }

  toggleRole(role: string): void {
    const idx = this.roles.indexOf(role);
    if (idx >= 0) {
      this.roles = this.roles.filter((r) => r !== role);
    } else {
      this.roles = [...this.roles, role];
    }
  }

  ngOnInit(): void {
    this.api.getLocations().subscribe({
      next: (data: any) => {
        const rows = Array.isArray(data) ? data : data?.rows ?? data?.data ?? [];
        this.allLocations = rows.map((r: any) => ({ id: String(r.id ?? r.locationId ?? ''), name: String(r.name ?? r.locationName ?? r.displayName ?? '') })).filter((r: { id: string }) => r.id);
      }
    });
  }

  createUser(): void {
    this.message = '';
    this.error = '';
    if (!this.password?.trim()) {
      this.error = 'Password is required.';
      return;
    }
    if (!this.roles.length) {
      this.error = 'Select at least one role.';
      return;
    }
    this.creating = true;
    const payload: any = {
      username: this.username?.trim() || this.generatedUsername,
      password: this.password,
      role: this.roles[0],
      roles: this.roles,
      firstName: this.firstName.trim(),
      lastName: this.lastName.trim(),
      email: this.email?.trim() || undefined,
    };
    if (this.selectedLocationIds.length) {
      payload.locationIds = this.selectedLocationIds;
    }
    this.api.createUser(payload).subscribe({
      next: () => {
        this.message = 'User created successfully.';
        this.firstName = '';
        this.lastName = '';
        this.email = '';
        this.username = '';
        this.password = '';
        this.roles = ['dispatcher'];
        this.selectedLocationIds = [];
        this.creating = false;
      },
      error: (err) => {
        this.error = err.error?.error || err.error?.message || 'Failed to create user.';
        this.creating = false;
      }
    });
  }
}
