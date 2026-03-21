import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { SeoService } from '../../services/seo.service';
import { SEO_PUBLIC } from '../../services/seo-public-presets';

@Component({
  selector: 'app-forgot-password',
  templateUrl: './forgot-password.component.html',
  styleUrls: ['./forgot-password.component.css']
})
export class ForgotPasswordComponent implements OnInit {
  form: FormGroup;
  submitting = false;
  submitted = false;
  error = '';

  constructor(
    private fb: FormBuilder,
    private api: ApiService,
    private router: Router,
    private seo: SeoService
  ) {
    this.form = this.fb.group({
      email: ['', [Validators.required, Validators.email]]
    });
  }

  ngOnInit(): void {
    this.seo.apply(SEO_PUBLIC.forgotPassword);
  }

  get emailInvalid(): boolean {
    const control = this.form.get('email');
    return !!(control && control.invalid && (control.touched || control.dirty));
  }

  submit(): void {
    if (this.form.invalid || this.submitting) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting = true;
    this.error = '';
    const email = String(this.form.value.email || '').trim();

    this.api.forgotPassword(email).subscribe({
      next: () => {
        this.submitted = true;
        this.submitting = false;
      },
      error: () => {
        // Keep response generic for security and UX consistency.
        this.submitted = true;
        this.submitting = false;
      }
    });
  }

  goToLogin(): void {
    this.router.navigate(['/login']);
  }
}
