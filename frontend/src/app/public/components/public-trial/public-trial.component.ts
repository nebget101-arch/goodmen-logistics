import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../services/api.service';
import { MARKETING_PLANS, FLEET_SIZE_OPTIONS } from '../../config/marketing.config';

@Component({
  selector: 'app-public-trial',
  templateUrl: './public-trial.component.html',
  styleUrls: ['./public-trial.component.css']
})
export class PublicTrialComponent implements OnInit {
  plans = MARKETING_PLANS.filter(plan => plan.trialEligible !== false);
  fleetSizeOptions = FLEET_SIZE_OPTIONS;
  mobileNavOpen = false;
  currentYear = new Date().getFullYear();

  form: FormGroup;
  submitting = false;
  success = false;
  submitError = '';

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private apiService: ApiService
  ) {
    this.form = this.fb.group({
      companyName: ['', [Validators.required, Validators.maxLength(200)]],
      contactName: ['', [Validators.required, Validators.maxLength(200)]],
      email: ['', [Validators.required, Validators.email, Validators.maxLength(300)]],
      phone: ['', [Validators.required, Validators.maxLength(50)]],
      fleetSize: ['', Validators.required],
      currentSystem: ['', Validators.maxLength(200)],
      requestedPlan: ['basic', Validators.required],
      wantsDemoAssistance: [false],
      notes: ['', Validators.maxLength(2000)]
    });
  }

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      const plan = params['plan'];
      if (plan && ['basic', 'multi_mc', 'end_to_end'].includes(plan)) {
        this.form.patchValue({ requestedPlan: plan });
      }
    });
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting = true;
    this.submitError = '';

    this.apiService.submitTrialRequest(this.form.value).subscribe({
      next: () => {
        this.success = true;
        this.submitting = false;
      },
      error: (err: any) => {
        this.submitting = false;
        const msg = err?.error?.error || err?.error?.message || err?.message;
        this.submitError =
          msg && typeof msg === 'string'
            ? msg
            : 'Something went wrong. Please try again or contact us directly.';
      }
    });
  }

  goBack(): void {
    this.router.navigate(['/home']);
  }

  goToLogin(): void {
    this.router.navigate(['/login']);
  }

  scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  toggleMobileNav(): void {
    this.mobileNavOpen = !this.mobileNavOpen;
  }

  closeMobileNav(): void {
    this.mobileNavOpen = false;
  }

  isFieldInvalid(fieldName: string): boolean {
    const field = this.form.get(fieldName);
    return !!(field && field.invalid && (field.dirty || field.touched));
  }

  getFieldError(fieldName: string): string {
    const field = this.form.get(fieldName);
    if (!field || !field.errors || !(field.dirty || field.touched)) return '';
    if (field.errors['required']) return 'This field is required';
    if (field.errors['email']) return 'Please enter a valid email address';
    if (field.errors['maxlength']) return 'Value is too long';
    return 'Invalid value';
  }
}
