'use strict';

/**
 * FleetNeuron subscription plan definitions.
 * Single source of truth for plan IDs, names, and metadata.
 * Keeps plan content easy to update without touching service logic.
 */

const PLANS = {
  basic: {
    id: 'basic',
    name: 'Basic',
    tagline: 'Single carrier operations',
    description:
      'Best for smaller fleets operating under one carrier authority and looking to digitize their core workflows.',
    priceLabel: 'Contact Sales',
    highlighted: false,
    features: [
      'One carrier tenant',
      'Core dispatch tools',
      'Basic driver workflows',
      'Basic maintenance & work order support',
      'Standard visibility & reporting',
      'Limited AI workflows',
      'Free trial available'
    ]
  },
  multi_mc: {
    id: 'multi_mc',
    name: 'Multi-MC',
    tagline: 'Multiple MCs, centralized control',
    description:
      'Designed for businesses operating multiple MCs, entities, or business units that need centralized management and controlled access.',
    priceLabel: 'Contact Sales',
    highlighted: true,
    badge: 'Most Popular',
    features: [
      'Multi-tenant / multi-company support',
      'Multiple MC support',
      'Shared admin visibility',
      'Role-aware company access controls',
      'Cross-company operational visibility',
      'Expanded reporting',
      'Enhanced AI workflows',
      'Free trial available'
    ]
  },
  end_to_end: {
    id: 'end_to_end',
    name: 'End-to-End',
    tagline: 'Full platform, maximum coverage',
    description:
      'Built for companies that want the full FleetNeuron platform across dispatch, safety, maintenance, inventory, AI workflows, and advanced operational control.',
    priceLabel: 'Contact Sales',
    highlighted: false,
    features: [
      'Everything in Multi-MC',
      'Full dispatch + safety + maintenance + inventory',
      'Advanced AI automation support',
      'Broader operational visibility',
      'Implementation & onboarding support',
      'API / integration readiness',
      'Advanced permissions & workflow flexibility',
      'Priority support'
    ]
  }
};

const VALID_PLAN_IDS = Object.keys(PLANS);

const TRIAL_REQUEST_STATUSES = [
  'new',
  'contacted',
  'approved',
  'rejected',
  'converted',
  'trial_created'
];

module.exports = { PLANS, VALID_PLAN_IDS, TRIAL_REQUEST_STATUSES };
