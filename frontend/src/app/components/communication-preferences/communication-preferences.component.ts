import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { SeoService } from '../../services/seo.service';
import { SEO_PUBLIC } from '../../services/seo-public-presets';

@Component({
  selector: 'app-communication-preferences',
  templateUrl: './communication-preferences.component.html',
  styleUrls: ['./communication-preferences.component.css']
})
export class CommunicationPreferencesComponent implements OnInit {
  email = '';
  phone = '';
  optInEmail = true;
  optInSms = true;
  saving = false;
  message: string | null = null;
  isError = false;

  constructor(
    private api: ApiService,
    private seo: SeoService
  ) {}

  ngOnInit(): void {
    this.seo.apply(SEO_PUBLIC.communicationPreferences);
  }

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

