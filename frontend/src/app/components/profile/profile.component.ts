import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AccessControlService } from '../../services/access-control.service';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.css']
})
export class ProfileComponent {
  constructor(
    public access: AccessControlService,
    private router: Router
  ) {}

  get displayName(): string {
    const u = this.access.getUser();
    if (!u) return localStorage.getItem('displayName') || localStorage.getItem('username') || 'User';
    const first = u.firstName || '';
    const last = u.lastName || '';
    if (first || last) return [first, last].filter(Boolean).join(' ');
    return u.username || u.email || 'User';
  }

  get roles(): string[] {
    return this.access.getRoles() || [];
  }

  get locations(): { id: string; name: string }[] {
    return this.access.getLocations() || [];
  }

  get permissions(): string[] {
    return this.access.getPermissions() || [];
  }
}
