import { Component, OnInit, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import {
  MarketingFeature,
  MARKETING_FEATURES,
  MARKETING_PLANS,
  HOW_IT_WORKS_STEPS,
  AI_BENEFITS
} from '../../config/marketing.config';

type ComparisonPlanId = 'starter' | 'professional' | 'advanced' | 'enterprise';

interface PlanComparisonColumn {
  id: ComparisonPlanId;
  name: string;
  ctaLabel: string;
  ctaAction: 'trial' | 'contact';
  ctaPlanId?: 'basic' | 'multi_mc' | 'end_to_end' | 'enterprise';
  popular?: boolean;
}

interface PlanComparisonRow {
  feature: string;
  values: Record<ComparisonPlanId, string>;
}

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

  comparisonPlans: PlanComparisonColumn[] = [
    {
      id: 'starter',
      name: 'Starter',
      ctaLabel: 'Start Free Trial',
      ctaAction: 'trial',
      ctaPlanId: 'basic',
    },
    {
      id: 'professional',
      name: 'Professional',
      ctaLabel: 'Start Free Trial',
      ctaAction: 'trial',
      ctaPlanId: 'multi_mc',
      popular: true,
    },
    {
      id: 'advanced',
      name: 'Advanced',
      ctaLabel: 'Start Free Trial',
      ctaAction: 'trial',
      ctaPlanId: 'end_to_end',
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      ctaLabel: 'Contact Sales',
      ctaAction: 'contact',
      ctaPlanId: 'enterprise',
    }
  ];

  comparisonRows: PlanComparisonRow[] = [
    {
      feature: 'Number of vehicles included',
      values: {
        starter: 'Up to 25',
        professional: 'Up to 100',
        advanced: 'Up to 300',
        enterprise: 'Unlimited',
      }
    },
    {
      feature: 'Number of drivers included',
      values: {
        starter: 'Up to 20',
        professional: 'Up to 80',
        advanced: 'Up to 250',
        enterprise: 'Unlimited',
      }
    },
    {
      feature: 'Real-time GPS tracking',
      values: { starter: '✅', professional: '✅', advanced: '✅', enterprise: '✅' }
    },
    {
      feature: 'Route optimization',
      values: { starter: '✗', professional: '✅', advanced: '✅', enterprise: '✅' }
    },
    {
      feature: 'Driver onboarding / employment applications',
      values: { starter: '✅', professional: '✅', advanced: '✅', enterprise: '✅' }
    },
    {
      feature: 'Maintenance scheduling',
      values: { starter: '✅', professional: '✅', advanced: '✅', enterprise: '✅' }
    },
    {
      feature: 'Reporting & analytics',
      values: { starter: 'Standard', professional: 'Advanced', advanced: 'Advanced + AI', enterprise: 'Custom BI' }
    },
    {
      feature: 'API access',
      values: { starter: '✗', professional: 'Read-only', advanced: 'Full API', enterprise: 'Full API + SLA' }
    },
    {
      feature: 'Custom integrations',
      values: { starter: '✗', professional: 'Limited', advanced: '✅', enterprise: '✅' }
    },
    {
      feature: 'Priority support / dedicated CSM',
      values: { starter: '✗', professional: 'Priority support', advanced: 'Priority support', enterprise: 'Dedicated CSM' }
    },
    {
      feature: 'SLA guarantee',
      values: { starter: '✗', professional: '✗', advanced: '99.5%', enterprise: '99.9%' }
    },
    {
      feature: 'Custom branding',
      values: { starter: '✗', professional: '✗', advanced: '✅', enterprise: '✅' }
    },
    {
      feature: 'Multi-depot support',
      values: { starter: '✗', professional: '✅', advanced: '✅', enterprise: '✅' }
    }
  ];

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

  handleComparisonCta(plan: PlanComparisonColumn): void {
    if (plan.ctaAction === 'contact' || plan.id === 'enterprise') {
      this.navigateToContact();
      return;
    }
    this.navigateToTrial(plan.ctaPlanId || 'basic');
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
