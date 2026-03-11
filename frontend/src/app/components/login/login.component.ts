import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AccessControlService } from '../../services/access-control.service';
import { OperatingEntityContextService } from '../../services/operating-entity-context.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {
  username = '';
  password = '';
  error = '';

  constructor(
    private api: ApiService,
    private router: Router,
    private accessControl: AccessControlService,
    private operatingEntityContext: OperatingEntityContextService
  ) {}

  login(): void {
    this.api.login(this.username, this.password).subscribe({
      next: (res) => {
        localStorage.setItem('token', res.token);
        if (res.role) {
          localStorage.setItem('role', String(res.role).toLowerCase().trim());
        }
        if (res.username) {
          localStorage.setItem('username', res.username);
        }
        if (res.firstName || res.lastName) {
          const displayName = `${res.firstName || ''}${res.firstName && res.lastName ? '.' : ''}${res.lastName || ''}`.trim().toLowerCase();
          if (displayName) {
            localStorage.setItem('displayName', displayName);
          }
        }
        this.accessControl.setAccessFromLoginResponse(res);
        this.operatingEntityContext.bootstrapFromSessionIfNeeded(true);
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        const msg = err?.error?.error ?? err?.error?.detail ?? err?.message;
        const isServerError = err?.status >= 500;
        this.error =
          msg && (typeof msg === 'string' ? msg : String(msg)).trim()
            ? (typeof msg === 'string' ? msg : String(msg)).trim()
            : isServerError
              ? 'Server error. Please try again or check that the API is running.'
              : 'Invalid username or password';
      }
    });
  }
}
