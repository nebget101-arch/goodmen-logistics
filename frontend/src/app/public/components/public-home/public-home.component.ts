import { Component, OnInit, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import {
  MarketingFeature,
  MarketingPlan,
  MARKETING_FEATURES,
  MARKETING_PLANS,
  HOW_IT_WORKS_STEPS,
  AI_BENEFITS
} from '../../config/marketing.config';

@Component({
  selector: 'app-public-home',
  templateUrl: './public-home.component.html',
  styleUrls: ['./public-home.component.css']
})
export class PublicHomeComponent implements OnInit {
  features = MARKETING_FEATURES;
  plans = MARKETING_PLANS;
  steps = HOW_IT_WORKS_STEPS;
  aiBenefits = AI_BENEFITS;
  selectedFeature: MarketingFeature | null = null;

  mobileNavOpen = false;
  navScrolled = false;
  currentYear = new Date().getFullYear();

  constructor(private router: Router) {}

  ngOnInit(): void {}

  @HostListener('window:scroll')
  onWindowScroll(): void {
    this.navScrolled = window.scrollY > 40;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeFeatureDetail();
  }

  scrollToSection(id: string): void {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    this.mobileNavOpen = false;
  }

  navigateToTrial(planId?: string): void {
    if (planId) {
      this.router.navigate(['/home/trial'], { queryParams: { plan: planId } });
    } else {
      this.router.navigate(['/home/trial']);
    }
  }

  navigateToContact(): void {
    this.router.navigate(['/home/contact']);
  }

  handlePlanCta(plan: { id: string; ctaAction?: 'trial' | 'contact' }): void {
    if (plan?.ctaAction === 'contact' || plan?.id === 'enterprise') {
      this.navigateToContact();
      return;
    }
    this.navigateToTrial(plan?.id);
  }

  getPlanUserAllowance(plan: MarketingPlan): string {
    return `${plan.includedUsers ?? 1} users included`;
  }

  getPlanSeatPricing(plan: MarketingPlan): string {
    return `+$${plan.additionalUserPriceUsd ?? 25}/user`;
  }

  goToLogin(): void {
    this.router.navigate(['/login']);
  }

  openFeatureDetail(feature: MarketingFeature): void {
    this.selectedFeature = feature;
    document.body.style.overflow = 'hidden';
  }

  closeFeatureDetail(): void {
    if (!this.selectedFeature) return;
    this.selectedFeature = null;
    document.body.style.overflow = '';
  }

  getMetricToneClass(tone: string): string {
    return `pub-badge-${tone}`;
  }

  getRowToneClass(tone: string): string {
    return `pub-pill-${tone}`;
  }

  toggleMobileNav(): void {
    this.mobileNavOpen = !this.mobileNavOpen;
  }

  closeMobileNav(): void {
    this.mobileNavOpen = false;
  }
}
