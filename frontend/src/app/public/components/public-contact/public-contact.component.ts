import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ApiService } from '../../../services/api.service';
import { SeoService } from '../../../services/seo.service';
import { SEO_PUBLIC } from '../../../services/seo-public-presets';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-public-contact',
  templateUrl: './public-contact.component.html',
  styleUrls: ['./public-contact.component.css']
})
export class PublicContactComponent implements OnInit, OnDestroy {
  currentYear = new Date().getFullYear();
  mobileNavOpen = false;
  
  contactForm!: FormGroup;
  showForm = true;
  successMessage = '';
  errorMessage = '';
  isSubmitting = false;
  
  private destroy$ = new Subject<void>();

  constructor(
    private readonly router: Router,
    private readonly fb: FormBuilder,
    private readonly api: ApiService,
    private readonly seo: SeoService
  ) {}

  ngOnInit(): void {
    this.seo.apply(SEO_PUBLIC.contact);
    this.initForm();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  initForm(): void {
    this.contactForm = this.fb.group({
      fullName: ['', [Validators.required, Validators.minLength(2)]],
      businessEmail: ['', [Validators.required, Validators.email]],
      companyName: ['', [Validators.required, Validators.minLength(2)]],
      message: ['', [Validators.required, Validators.minLength(10)]],
      phoneNumber: [''],
      fleetSize: ['']
    });
  }

  submit(): void {
    if (this.contactForm.invalid || this.isSubmitting) {
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.api.submitContactForm(this.contactForm.value)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.isSubmitting = false;
          this.successMessage = 'Thanks for reaching out! We typically respond within 1 business day.';
          this.showForm = false;
          this.contactForm.reset();
          
          // Auto-reset after 10 seconds
          setTimeout(() => {
            this.showForm = true;
            this.successMessage = '';
          }, 10000);
        },
        error: (err: any) => {
          this.isSubmitting = false;
          this.errorMessage = err?.error?.message || 'Unable to send your message. Please try again later.';
        }
      });
  }

  goHome(): void {
    this.router.navigate(['/home']);
  }

  goToTrial(): void {
    this.router.navigate(['/home/trial']);
  }

  goToLogin(): void {
    this.router.navigate(['/login']);
  }

  toggleMobileNav(): void {
    this.mobileNavOpen = !this.mobileNavOpen;
  }

  get fullName() {
    return this.contactForm.get('fullName');
  }

  get businessEmail() {
    return this.contactForm.get('businessEmail');
  }

  get companyName() {
    return this.contactForm.get('companyName');
  }

  get message() {
    return this.contactForm.get('message');
  }

  fleetSizeOptions: { value: string; label: string }[] = [
    { value: '1-10', label: '1-10 vehicles' },
    { value: '11-50', label: '11-50 vehicles' },
    { value: '51-100', label: '51-100 vehicles' },
    { value: '101-250', label: '101-250 vehicles' },
    { value: '251-500', label: '251-500 vehicles' },
    { value: '501+', label: '500+ vehicles' }
  ];
}
