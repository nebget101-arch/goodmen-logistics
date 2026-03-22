import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../../services/api.service';
import { SeoService } from '../../../services/seo.service';
import { SEO_PUBLIC } from '../../../services/seo-public-presets';
import { MARKETING_PLANS, FLEET_SIZE_OPTIONS, MarketingPlan } from '../../config/marketing.config';

@Component({
  selector: 'app-public-trial',
  templateUrl: './public-trial.component.html',
  styleUrls: ['./public-trial.component.css']
})
export class PublicTrialComponent implements OnInit, OnDestroy {
  plans: MarketingPlan[] = MARKETING_PLANS.filter(plan => plan.trialEligible !== false);
  fleetSizeOptions = FLEET_SIZE_OPTIONS;
  get fleetSizeSelectOptions(): { value: string; label: string }[] {
    return this.fleetSizeOptions.map(s => ({ value: s, label: s }));
  }
  get requestedPlanOptions(): { value: string; label: string }[] {
    return this.plans.map(p => ({ value: p.id, label: `${p.name} — ${p.tagline}` }));
  }
  mobileNavOpen = false;
  currentYear = new Date().getFullYear();

  form: FormGroup;
  submitting = false;
  success = false;
  submitError = '';
  private readonly dotMcPattern = /^\d{1,8}$/;

  /** FN-101: FMCSA carrier lookup state */
  dotLookupStatus: 'idle' | 'loading' | 'active' | 'inactive' | 'not-found' | 'error' = 'idle';
  private dotLookupSub: Subscription | null = null;;

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private apiService: ApiService,
    private seo: SeoService
  ) {
    this.form = this.fb.group({
      companyName: ['', [Validators.required, Validators.maxLength(200)]],
      dotNumber: ['', [Validators.required, Validators.pattern(this.dotMcPattern), Validators.maxLength(8)]],
      mcNumber: ['', [Validators.pattern(this.dotMcPattern), Validators.maxLength(8)]],
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
    this.seo.apply(SEO_PUBLIC.trial);
    this.route.queryParams.subscribe(params => {
      const plan = params['plan'];
      if (plan && ['basic', 'multi_mc', 'end_to_end', 'enterprise'].includes(plan)) {
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

    const dotNumber = this.normalizeNumeric(this.form.value.dotNumber);
    const mcNumber = this.normalizeNumeric(this.form.value.mcNumber);

    this.apiService.submitTrialRequest({
      companyName: this.form.value.companyName,
      contactName: this.form.value.contactName,
      email: this.form.value.email,
      phone: this.form.value.phone,
      fleetSize: this.form.value.fleetSize,
      currentSystem: this.form.value.currentSystem,
      requestedPlan: this.form.value.requestedPlan,
      wantsDemoAssistance: this.form.value.wantsDemoAssistance,
      notes: this.form.value.notes,
      dot_number: dotNumber ?? '',
      mc_number: mcNumber
    }).subscribe({
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

  selectPlan(planId: MarketingPlan['id']): void {
    this.form.patchValue({ requestedPlan: planId });
  }

  get selectedPlan(): MarketingPlan {
    const selectedId = this.form.get('requestedPlan')?.value as MarketingPlan['id'] | null;
    return this.plans.find(plan => plan.id === selectedId) || this.plans[0];
  }

  getPlanUserAllowance(plan: MarketingPlan): string {
    return `${plan.includedUsers ?? 1} users included`;
  }

  getPlanSeatPricing(plan: MarketingPlan): string {
    return `+$${plan.additionalUserPriceUsd ?? 25}/user`;
  }

  getFieldError(fieldName: string): string {
    const field = this.form.get(fieldName);
    if (!field || !field.errors || !(field.dirty || field.touched)) return '';
    if (field.errors['required']) return 'This field is required';
    if (field.errors['pattern']) {
      if (fieldName === 'dotNumber') return 'USDOT must be 1–8 digits';
      if (fieldName === 'mcNumber') return 'MC number must be 1–8 digits';
      return 'Invalid format';
    }
    if (field.errors['email']) return 'Please enter a valid email address';
    if (field.errors['maxlength']) {
      if (fieldName === 'dotNumber' || fieldName === 'mcNumber') return 'Maximum 8 digits';
      return 'Value is too long';
    }
    return 'Invalid value';
  }

  private normalizeNumeric(value: unknown): string | null {
    const digitsOnly = String(value || '')
      .trim()
      .replace(/\D+/g, '');
    return digitsOnly ? digitsOnly.slice(0, 8) : null;
  }

  ngOnDestroy(): void {
    this.dotLookupSub?.unsubscribe();
  }

  /**
   * FN-101: Triggered on blur of the USDOT field.
   * Looks up the carrier and pre-fills company name / MC number.
   */
  onDotBlur(): void {
    const raw = this.form.get('dotNumber')?.value ?? '';
    const digits = this.normalizeNumeric(raw);

    // Clear badge when field is empty or too short to query.
    if (!digits) {
      this.dotLookupStatus = 'idle';
      return;
    }
    if (digits.length < 7) {
      return;
    }

    // Cancel any still-running request before starting a new one.
    this.dotLookupSub?.unsubscribe();
    this.dotLookupStatus = 'loading';

    this.dotLookupSub = this.apiService.fmcsaLookup(digits).subscribe({
      next: (result) => {
        if (!result.found) {
          // Should not normally arrive here (backend sends 404 for not-found),
          // but handle defensively.
          this.dotLookupStatus = 'not-found';
          return;
        }

        // Pre-fill company name with FMCSA legal name.
        if (result.legalName) {
          this.form.patchValue({ companyName: result.legalName });
          // Mark the field dirty so validators re-evaluate.
          this.form.get('companyName')?.markAsDirty();
        }

        // Pre-fill MC number only when the user hasn't typed one yet.
        if (result.mcNumber && !this.normalizeNumeric(this.form.get('mcNumber')?.value)) {
          this.form.patchValue({ mcNumber: result.mcNumber });
          this.form.get('mcNumber')?.markAsDirty();
        }

        this.dotLookupStatus = result.status === 'ACTIVE' ? 'active' : 'inactive';
      },
      error: (err: any) => {
        if (err?.status === 404) {
          // DOT not found in FMCSA database.
          this.dotLookupStatus = 'not-found';
          return;
        }
        // 503 / network failure — silent: hide spinner, leave form usable.
        console.warn('[fmcsa] lookup unavailable:', err?.status ?? 'network error');
        this.dotLookupStatus = 'error';
      }
    });
  }

  /** Accessible label for the badge slot, consumed by aria-live region. */
  get dotBadgeAriaLabel(): string {
    switch (this.dotLookupStatus) {
      case 'loading':   return 'Looking up carrier information';
      case 'active':    return 'Verified active FMCSA carrier';
      case 'inactive':  return 'Carrier is not currently active';
      case 'not-found': return 'DOT number not found in FMCSA database';
      default:          return '';
    }
  }
}
