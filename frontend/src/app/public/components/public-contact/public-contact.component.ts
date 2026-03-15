import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-public-contact',
  templateUrl: './public-contact.component.html',
  styleUrls: ['./public-contact.component.css']
})
export class PublicContactComponent {
  currentYear = new Date().getFullYear();
  mobileNavOpen = false;

  constructor(private readonly router: Router) {}

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
}
