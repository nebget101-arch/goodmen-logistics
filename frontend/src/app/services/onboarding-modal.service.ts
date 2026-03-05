import { Injectable } from '@angular/core';

export interface OnboardingDriver {
  id: string;
  firstName?: string;
  lastName?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  phone_number?: string;
  email?: string;
}

@Injectable({ providedIn: 'root' })
export class OnboardingModalService {
  isOpen = false;
  driver: OnboardingDriver | null = null;
  via: 'sms' | 'email' | 'both' = 'sms';
  phone = '';
  email = '';
  sending = false;
  resultUrl: string | null = null;

  open(driver: OnboardingDriver | null): void {
    if (!driver) return;
    this.driver = driver;
    this.via = 'sms';
    this.phone = driver?.phone || driver?.phone_number || '';
    this.email = driver?.email || '';
    this.resultUrl = null;
    this.sending = false;
    this.isOpen = true;
  }

  close(): void {
    if (this.sending) return;
    this.isOpen = false;
    this.driver = null;
    this.resultUrl = null;
  }

  setResultUrl(url: string | null): void {
    this.resultUrl = url;
  }

  setSending(value: boolean): void {
    this.sending = value;
  }
}
