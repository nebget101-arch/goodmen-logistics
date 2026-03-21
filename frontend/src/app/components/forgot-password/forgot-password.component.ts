import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-forgot-password',
  templateUrl: './forgot-password.component.html',
  styleUrls: ['./forgot-password.component.css']
})
export class ForgotPasswordComponent {
  form: FormGroup;
  submitting = false;
  submitted = false;
  error = '';

  constructor(
    private fb: FormBuilder,
    private api: ApiService,
    private router: Router
  ) {
    this.form = this.fb.group({
      email: ['', [Validators.required, Validators.email]]
    });
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
