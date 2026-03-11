/**
 * Marketing website content configuration.
 * All text, features, plans, and content blocks are centralized here
 * so copy and structure can be updated without touching component logic.
 */

export interface MarketingFeature {
  icon: string;
  title: string;
  description: string;
}

export interface PlanFeature {
  text: string;
  highlight?: boolean;
}

export interface MarketingPlan {
  id: 'basic' | 'multi_mc' | 'end_to_end';
  name: string;
  tagline: string;
  description: string;
  priceLabel: string;
  highlighted: boolean;
  badge?: string;
  features: PlanFeature[];
}

export interface HowItWorksStep {
  step: string;
  title: string;
  description: string;
}

export interface AiBenefit {
  icon: string;
  text: string;
}

// ─── Features ────────────────────────────────────────────────────────────────

export const MARKETING_FEATURES: MarketingFeature[] = [
  {
    icon: 'document_scanner',
    title: 'AI Load Intake',
    description: 'Extract load details from documents automatically, reducing manual data entry.'
  },
  {
    icon: 'local_shipping',
    title: 'Dispatch Management',
    description: 'Track loads, assignments, statuses, and driver visibility across your fleet.'
  },
  {
    icon: 'badge',
    title: 'Driver & DQF Management',
    description: 'Organize drivers, onboarding, compliance records, and qualification files.'
  },
  {
    icon: 'security',
    title: 'Safety & Compliance',
    description: 'Track incidents, violations, reminders, and compliance actions in one place.'
  },
  {
    icon: 'build',
    title: 'Maintenance & Work Orders',
    description: 'Manage repairs, shops, service history, and technician workflows.'
  },
  {
    icon: 'inventory_2',
    title: 'Parts & Inventory',
    description: 'Handle receiving, stock, transfers, and parts visibility across your operation.'
  },
  {
    icon: 'domain',
    title: 'Multi-Company Operations',
    description: 'Manage one company or multiple MC/business entities under a single platform.'
  },
  {
    icon: 'psychology',
    title: 'Smart AI Assistance',
    description: 'Reduce manual work and improve operational speed with built-in AI workflows.'
  },
  {
    icon: 'payments',
    title: 'Accounting Workflow Support',
    description: 'Support settlements, payroll-related operations, and cost visibility.'
  },
  {
    icon: 'smartphone',
    title: 'Mobile-Friendly Access',
    description: 'Enable teams to work from anywhere with a responsive, modern interface.'
  }
];

// ─── How It Works ─────────────────────────────────────────────────────────────

export const HOW_IT_WORKS_STEPS: HowItWorksStep[] = [
  {
    step: '01',
    title: 'Centralize Your Fleet',
    description:
      'Bring your drivers, vehicles, loads, and operations into a single intelligent platform.'
  },
  {
    step: '02',
    title: 'Automate Repetitive Tasks',
    description:
      'Let AI handle document intake, status updates, and routine operational workflows.'
  },
  {
    step: '03',
    title: 'Scale From One to Many',
    description:
      'Start with one carrier authority and expand to multi-MC, multi-company operations as you grow.'
  },
  {
    step: '04',
    title: 'Gain Visibility & Control',
    description:
      'Make better decisions with real-time dashboards, reports, and AI-powered operational intelligence.'
  }
];

// ─── AI Benefits ──────────────────────────────────────────────────────────────

export const AI_BENEFITS: AiBenefit[] = [
  { icon: 'edit_off', text: 'Reduce manual data entry from documents and emails' },
  { icon: 'speed', text: 'Speed up operational workflows with automated intake' },
  { icon: 'verified', text: 'Improve accuracy across document-based processes' },
  { icon: 'insights', text: 'Support smarter fleet decisions with AI assistance' },
  { icon: 'trending_up', text: 'Scale operations without scaling admin burden' }
];

// ─── Subscription Plans ───────────────────────────────────────────────────────

export const MARKETING_PLANS: MarketingPlan[] = [
  {
    id: 'basic',
    name: 'Basic',
    tagline: 'Single carrier operations',
    description:
      'Best for smaller fleets operating under one carrier authority and looking to digitize their core workflows.',
    priceLabel: 'Contact Sales',
    highlighted: false,
    features: [
      { text: 'One carrier tenant' },
      { text: 'Core dispatch tools' },
      { text: 'Basic driver workflows' },
      { text: 'Basic maintenance & work order support' },
      { text: 'Standard visibility & reporting' },
      { text: 'Limited AI workflows' },
      { text: 'Free trial available', highlight: true }
    ]
  },
  {
    id: 'multi_mc',
    name: 'Multi-MC',
    tagline: 'Multiple MCs, centralized control',
    description:
      'Designed for businesses operating multiple MCs, entities, or business units that need centralized management and controlled access.',
    priceLabel: 'Contact Sales',
    highlighted: true,
    badge: 'Most Popular',
    features: [
      { text: 'Multi-tenant / multi-company support', highlight: true },
      { text: 'Multiple MC support', highlight: true },
      { text: 'Shared admin visibility' },
      { text: 'Role-aware company access controls' },
      { text: 'Cross-company operational visibility' },
      { text: 'Expanded reporting' },
      { text: 'Enhanced AI workflows' },
      { text: 'Free trial available', highlight: true }
    ]
  },
  {
    id: 'end_to_end',
    name: 'End-to-End',
    tagline: 'Full platform, maximum coverage',
    description:
      'Built for companies that want the full FleetNeuron platform across dispatch, safety, maintenance, inventory, AI workflows, and advanced operational control.',
    priceLabel: 'Contact Sales',
    highlighted: false,
    features: [
      { text: 'Everything in Multi-MC' },
      { text: 'Full dispatch + safety + maintenance + inventory' },
      { text: 'Advanced AI automation support', highlight: true },
      { text: 'Broader operational visibility' },
      { text: 'Implementation & onboarding support' },
      { text: 'API / integration readiness' },
      { text: 'Advanced permissions & workflow flexibility' },
      { text: 'Priority support' }
    ]
  }
];

// ─── Fleet Size Options ───────────────────────────────────────────────────────

export const FLEET_SIZE_OPTIONS = [
  '1–5 trucks',
  '6–20 trucks',
  '21–50 trucks',
  '51–100 trucks',
  '100+ trucks'
];
