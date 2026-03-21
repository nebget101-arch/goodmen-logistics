import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AccessControlService } from '../../services/access-control.service';
import { OperatingEntityContextService } from '../../services/operating-entity-context.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent implements OnInit {
  username = '';
  password = '';
  error = '';
  success = '';
  isSigningIn = false;
  private readonly authTransitionStorageKey = 'fleetneuron_auth_transitioning';
  private readonly signupResponseStorageKey = 'fleetneuron_signup_response';

  constructor(
    private api: ApiService,
    private route: ActivatedRoute,
    private router: Router,
    private accessControl: AccessControlService,
    private operatingEntityContext: OperatingEntityContextService
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      this.success = params.get('reset') === 'success'
        ? 'Password updated successfully. Please sign in.'
        : '';
    });
  }

  goToForgotPassword(): void {
    this.router.navigate(['/forgot-password']);
  }

  login(): void {
    if (this.isSigningIn) return;
    this.isSigningIn = true;
    this.error = '';
    sessionStorage.setItem(this.authTransitionStorageKey, '1');

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
        
        // Check if there's a stored signup response with plan data
        const storedSignupResponse = sessionStorage.getItem(this.signupResponseStorageKey);
        const responseToUse = res;
        
        // Merge plan data from signup response if not in login response
        if (storedSignupResponse && !res.plan) {
          try {
            const signupData = JSON.parse(storedSignupResponse);
            if (signupData.plan) {
              responseToUse.plan = signupData.plan;
              responseToUse.requestedPlan = signupData.requestedPlan;
            }
          } catch (e) {
            // Silently fail to parse; just use login response
          }
        }
        
        this.accessControl.setAccessFromLoginResponse(responseToUse);

        // Important: hydrate canonical RBAC + subscription plan context from /auth/me
        // immediately after login so plan-gated pages are hidden/shown correctly
        // without requiring a manual refresh.
        this.accessControl.loadAccess().subscribe({
          next: () => {
            this.operatingEntityContext.bootstrapFromSessionIfNeeded(true, { force: true });
            sessionStorage.removeItem(this.authTransitionStorageKey);
            this.isSigningIn = false;
            this.router.navigate(['/dashboard']);
          },
          error: () => {
            // loadAccess() catches and maps to null, but keep a safe fallback.
            this.operatingEntityContext.bootstrapFromSessionIfNeeded(true, { force: true });
            sessionStorage.removeItem(this.authTransitionStorageKey);
            this.isSigningIn = false;
            this.router.navigate(['/dashboard']);
          }
        });
      },
      error: (err) => {
        sessionStorage.removeItem(this.authTransitionStorageKey);
        this.isSigningIn = false;
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
