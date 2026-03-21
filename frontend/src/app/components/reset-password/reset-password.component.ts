import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { SeoService } from '../../services/seo.service';
import { SEO_PUBLIC } from '../../services/seo-public-presets';

@Component({
  selector: 'app-reset-password',
  templateUrl: './reset-password.component.html',
  styleUrls: ['./reset-password.component.css']
})
export class ResetPasswordComponent implements OnInit {
  form: FormGroup;
  token = '';
  submitting = false;
  success = false;
  error = '';

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private seo: SeoService
  ) {
    this.form = this.fb.group({
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', [Validators.required]]
    });
  }

  ngOnInit(): void {
    this.seo.apply(SEO_PUBLIC.resetPassword);
    this.route.queryParamMap.subscribe((params) => {
      this.token = String(params.get('token') || '').trim();
      if (!this.token) {
        this.error = 'Reset token is missing or invalid.';
      }
    });
  }

  get passwordMismatch(): boolean {
    const password = this.form.get('password')?.value;
    const confirmPassword = this.form.get('confirmPassword')?.value;
    return !!password && !!confirmPassword && password !== confirmPassword;
  }

  submit(): void {
    if (!this.token) {
      this.error = 'Reset token is missing or invalid.';
      return;
    }

    if (this.form.invalid || this.passwordMismatch || this.submitting) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting = true;
    this.error = '';
    const password = String(this.form.value.password || '');

    this.api.resetPassword(this.token, password).subscribe({
      next: () => {
        this.success = true;
        this.submitting = false;
        setTimeout(() => {
          this.router.navigate(['/login'], { queryParams: { reset: 'success' } });
        }, 900);
      },
      error: (err) => {
        this.submitting = false;
        const message = err?.error?.error || 'Reset link is invalid or expired.';
        this.error = typeof message === 'string' ? message : 'Reset link is invalid or expired.';
      }
    });
  }

  goToLogin(): void {
    this.router.navigate(['/login']);
  }
}
