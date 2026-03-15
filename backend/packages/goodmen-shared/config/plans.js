'use strict';

/**
 * FleetNeuron subscription plan definitions.
 * Single source of truth for plan IDs, names, and metadata.
 * Keeps plan content easy to update without touching service logic.
 */

const PLANS = {
  basic: {
    id: 'basic',
    name: 'Starter',
    tagline: 'Essential fleet operations',
    description:
      'Includes core dispatch, driver, compliance, and settlement workflows for a single operating entity.',
    priceLabel: '$149/mo',
    includedUsers: 2,
    additionalUserPriceUsd: 50,
    includedRoles: ['admin', 'dispatch'],
    includedPages: [
      '/dashboard',
      '/loads',
      '/dispatch-board',
      '/drivers',
      '/vehicles',
      '/trailers',
      '/hos',
      '/drivers/dqf',
      '/audit',
      '/settlements',
      '/settlements/scheduled-deductions',
      '/settlements/equipment-owners'
    ],
    highlighted: false,
    features: [
      'Dashboard, Loads, Dispatch Board, Drivers',
      'Trucks/Trailers, HOS, DQF, Audit',
      'Settlements: Scheduled Payments + Equipment Owners',
      '2 included users: Admin + Dispatch',
      '$50 per additional user'
    ]
  },
  multi_mc: {
    id: 'multi_mc',
    name: 'Professional',
    tagline: 'Multi-entity control and scale',
    description:
      'Everything in Basic plus multi-entity administration and broader role coverage for growing operations.',
    priceLabel: '$349/mo',
    includedUsers: 4,
    additionalUserPriceUsd: 50,
    includedRoles: ['admin', 'safety', 'dispatch', 'accounting'],
    includedPages: [
      '/dashboard',
      '/loads',
      '/dispatch-board',
      '/drivers',
      '/vehicles',
      '/trailers',
      '/hos',
      '/drivers/dqf',
      '/audit',
      '/settlements/scheduled-deductions',
      '/settlements/equipment-owners',
      '/admin/multi-mc'
    ],
    highlighted: true,
    badge: 'Most Popular',
    features: [
      'Everything in Basic',
      'Multi-entity admin page access',
      '4 included users: Admin, Safety, Dispatch, Accounting',
      'Cross-entity operational management',
      '$50 per additional user'
    ]
  },
  end_to_end: {
    id: 'end_to_end',
    name: 'Advanced',
    tagline: 'Full platform, maximum coverage',
    description:
      'Everything in Multi-MC plus full inventory, accounting, reporting, and roadside AI with larger included seat count.',
    priceLabel: '$799/mo',
    includedUsers: 10,
    additionalUserPriceUsd: 50,
    includedRoles: ['admin', 'safety', 'dispatch', 'accounting'],
    includedPages: [
      '/dashboard',
      '/loads',
      '/dispatch-board',
      '/drivers',
      '/vehicles',
      '/trailers',
      '/hos',
      '/drivers/dqf',
      '/audit',
      '/settlements/scheduled-deductions',
      '/settlements/equipment-owners',
      '/admin/multi-mc',
      '/parts',
      '/barcodes',
      '/receiving',
      '/inventory-transfers',
      '/direct-sales',
      '/inventory-reports',
      '/invoices',
      '/settlements',
      '/reports',
      '/roadside'
    ],
    highlighted: false,
    features: [
      'Everything in Multi-MC',
      'Inventory modules + accounting (invoices/settlements)',
      'Reports + Roadside AI',
      '10 included users',
      '$50 per additional user'
    ]
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'Enterprise operations and controls',
    description:
      'Everything in Advanced with enterprise support, governance, and large-scale rollout flexibility.',
    priceLabel: 'Contact us',
    includedUsers: 25,
    additionalUserPriceUsd: 0,
    includedRoles: ['admin', 'safety', 'dispatch', 'accounting'],
    includedPages: [
      '/dashboard',
      '/loads',
      '/dispatch-board',
      '/drivers',
      '/vehicles',
      '/trailers',
      '/hos',
      '/drivers/dqf',
      '/audit',
      '/settlements/scheduled-deductions',
      '/settlements/equipment-owners',
      '/admin/multi-mc',
      '/parts',
      '/barcodes',
      '/receiving',
      '/inventory-transfers',
      '/direct-sales',
      '/inventory-reports',
      '/invoices',
      '/settlements',
      '/reports',
      '/roadside'
    ],
    highlighted: false,
    features: [
      'Everything in Advanced',
      'Enterprise onboarding and governance controls',
      'Priority support and rollout planning',
      'Large user capacity'
    ]
  }
};

const PLAN_ID_ALIASES = {
  starter: 'basic',
  basic: 'basic',
  professional: 'multi_mc',
  multi_mc: 'multi_mc',
  advanced: 'end_to_end',
  end_to_end: 'end_to_end',
  enterprise: 'enterprise'
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

function normalizePlanId(rawPlanId, fallbackPlanId = 'basic') {
  const normalized = String(rawPlanId || '').trim().toLowerCase();
  const mapped = PLAN_ID_ALIASES[normalized] || normalized;
  if (mapped && PLANS[mapped]) {
    return mapped;
  }
  return PLANS[fallbackPlanId] ? fallbackPlanId : 'basic';
}

module.exports = { PLANS, VALID_PLAN_IDS, TRIAL_REQUEST_STATUSES, normalizePlanId };
