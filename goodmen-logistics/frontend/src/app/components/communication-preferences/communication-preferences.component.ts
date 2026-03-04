import { Component } from '@angular/core';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-communication-preferences',
  templateUrl: './communication-preferences.component.html',
  styleUrls: ['./communication-preferences.component.css']
})
export class CommunicationPreferencesComponent {
  email = '';
  phone = '';
  optInEmail = true;
  optInSms = true;
  saving = false;
  message: string | null = null;
  isError = false;

  constructor(private api: ApiService) {}

  save(): void {
    const trimmedEmail = this.email.trim();
    const digitsPhone = this.phone.replace(/\D/g, '').trim();

    if (!trimmedEmail && !digitsPhone) {
      this.message = 'Please enter your email or phone number.';
      this.isError = true;
      return;
    }

    this.saving = true;
    this.message = null;
    this.isError = false;

    this.api.updateCommunicationPreferences({
      email: trimmedEmail || undefined,
      phone: digitsPhone || undefined,
      optInEmail: this.optInEmail,
      optInSms: this.optInSms
    }).subscribe({
      next: () => {
        this.saving = false;
        this.message = 'Your communication preferences have been saved.';
        this.isError = false;
      },
      error: (err) => {
        this.saving = false;
        this.message = err?.error?.message || 'Failed to save preferences. Please try again.';
        this.isError = true;
      }
    });
  }
}

