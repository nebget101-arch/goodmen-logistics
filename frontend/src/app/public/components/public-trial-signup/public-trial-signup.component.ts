import { Component, OnInit } from '@angular/core';
import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { combineLatest } from 'rxjs';
import { ApiService } from '../../../services/api.service';
import { AccessControlService } from '../../../services/access-control.service';
import { SeoService } from '../../../services/seo.service';
import { SEO_PUBLIC } from '../../../services/seo-public-presets';
import { MARKETING_PLANS } from '../../config/marketing.config';

@Component({
  selector: 'app-public-trial-signup',
  templateUrl: './public-trial-signup.component.html',
  styleUrls: ['./public-trial-signup.component.css']
})
export class PublicTrialSignupComponent implements OnInit {
  mobileNavOpen = false;
  currentYear = new Date().getFullYear();

  token = '';
  loading = true;
  loadingError = '';
  submitError = '';
  submitting = false;

  signupCompleted = false;
  createdUsername = '';

  context: any = null;

  form: FormGroup;

  // Temporary storage for signup response to pass plan data to next login
  private readonly SIGNUP_RESPONSE_STORAGE_KEY = 'fleetneuron_signup_response';

  constructor(
    private readonly fb: FormBuilder,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly apiService: ApiService,
    private readonly accessControl: AccessControlService,
    private readonly seo: SeoService
  ) {
    this.form = this.fb.group(
      {
        firstName: ['', [Validators.maxLength(100)]],
        lastName: ['', [Validators.maxLength(100)]],
        username: ['', [Validators.maxLength(100)]],
        password: ['', [Validators.required, Validators.minLength(8)]],
        confirmPassword: ['', [Validators.required]]
      },
      { validators: this.passwordMatchValidator }
    );
  }

  ngOnInit(): void {
    combineLatest([this.route.queryParamMap, this.route.paramMap]).subscribe(([query, params]) => {
      const pathOnly = this.router.url.split('?')[0] || SEO_PUBLIC.trialSignup.path;
      this.seo.apply({ ...SEO_PUBLIC.trialSignup, path: pathOnly });

      const queryToken = (query.get('token') || query.get('signupToken') || query.get('signup_token') || '').trim();
      const pathToken = (params.get('token') || '').trim();
      this.token = queryToken || pathToken;

      if (!this.token) {
        this.loading = false;
        this.loadingError = 'Missing signup token. Please request a fresh signup link from FleetNeuron support.';
        return;
      }

      this.loadSignupContext();
    });
  }

  get selectedPlan(): any {
    const planId = String(this.context?.requestedPlan || '').trim();
    return MARKETING_PLANS.find(plan => plan.id === planId) || null;
  }

  submit(): void {
    if (this.form.invalid || !this.token) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting = true;
    this.submitError = '';

    const payload = {
      firstName: this.form.value.firstName || undefined,
      lastName: this.form.value.lastName || undefined,
      username: this.form.value.username || undefined,
      password: this.form.value.password
    };

    this.apiService.completeTrialSignup(this.token, payload).subscribe({
      next: (res: any) => {
        this.submitting = false;
        
        // Store the signup response (which includes plan/includedPages) in sessionStorage
        // so the access control service can retrieve it after login
        if (res?.data) {
          sessionStorage.setItem(this.SIGNUP_RESPONSE_STORAGE_KEY, JSON.stringify(res.data));
          // Immediately set access context from the signup response
          this.accessControl.setAccessFromLoginResponse(res.data);
        }
        
        this.signupCompleted = true;
        this.createdUsername =
          String(res?.data?.username || '').trim()
          || String(this.form.value.username || '').trim()
          || String(this.context?.email || '').trim();
      },
      error: (err: any) => {
        this.submitting = false;
        const msg = err?.error?.error || err?.error?.message || err?.message || 'Failed to complete signup.';
        this.submitError = typeof msg === 'string' ? msg : 'Failed to complete signup.';

        if (err?.status === 409) {
          this.loadSignupContext();
        }
      }
    });
  }

  goToLogin(): void {
    // If signup response was stored, use it to set access context before navigating to login
    const storedResponse = sessionStorage.getItem(this.SIGNUP_RESPONSE_STORAGE_KEY);
    if (storedResponse) {
      try {
        const data = JSON.parse(storedResponse);
        this.accessControl.setAccessFromLoginResponse(data);
      } catch (e) {
        // If parsing fails, just proceed to login (fallback to normal login flow)
      }
    }
    this.router.navigate(['/login']);
  }

  goHome(): void {
    this.router.navigate(['/home']);
  }

  toggleMobileNav(): void {
    this.mobileNavOpen = !this.mobileNavOpen;
  }

  isFieldInvalid(fieldName: string): boolean {
    const field = this.form.get(fieldName);
    return !!(field && field.invalid && (field.dirty || field.touched));
  }

  getFieldError(fieldName: string): string {
    const field = this.form.get(fieldName);
    if (!field || !field.errors || !(field.dirty || field.touched)) return '';

    if (field.errors['required']) return 'This field is required';
    if (field.errors['minlength']) return 'Must be at least 8 characters';
    if (field.errors['maxlength']) return 'Value is too long';
    return 'Invalid value';
  }

  get passwordMismatchError(): string {
    const formTouched = this.form.touched || this.form.dirty;
    if (!formTouched || !this.form.errors?.['passwordMismatch']) return '';
    return 'Passwords do not match';
  }

  private loadSignupContext(): void {
    this.loading = true;
    this.loadingError = '';
    this.submitError = '';
    this.signupCompleted = false;

    this.apiService.getTrialSignupContext(this.token).subscribe({
      next: (res: any) => {
        this.loading = false;
        this.context = res?.data || null;

        if (this.context?.status === 'completed') {
          this.signupCompleted = true;
          this.createdUsername = String(this.context?.email || '').trim();
        }
      },
      error: (err: any) => {
        this.loading = false;
        const msg = err?.error?.error || err?.error?.message || err?.message || 'Unable to load signup link.';
        this.loadingError = typeof msg === 'string' ? msg : 'Unable to load signup link.';
      }
    });
  }

  private passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
    const password = control.get('password')?.value;
    const confirmPassword = control.get('confirmPassword')?.value;

    if (!confirmPassword) return null;
    return password === confirmPassword ? null : { passwordMismatch: true };
  }
}
