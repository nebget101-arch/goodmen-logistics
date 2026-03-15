/**
 * Marketing website content configuration.
 * All text, features, plans, and content blocks are centralized here
 * so copy and structure can be updated without touching component logic.
 */

export interface MarketingFeature {
  icon: string;
  title: string;
  description: string;
  details: string[];
  capabilities: string[];
  mock: MarketingFeatureMock;
}

export type MarketingFeatureTone = 'green' | 'teal' | 'amber' | 'blue';

export interface MarketingFeatureMetric {
  label: string;
  value: string;
  tone: MarketingFeatureTone;
}

export interface MarketingFeatureRow {
  status: string;
  tone: 'green' | 'amber' | 'blue';
  primary: string;
  secondary: string;
  meta: string;
}

export interface MarketingFeatureMock {
  navLabel: string;
  title: string;
  subtitle: string;
  insight: string;
  metrics: MarketingFeatureMetric[];
  rows: MarketingFeatureRow[];
}

export interface PlanFeature {
  text: string;
  highlight?: boolean;
}

export interface MarketingPlan {
  id: 'basic' | 'multi_mc' | 'end_to_end' | 'enterprise';
  name: string;
  tagline: string;
  description: string;
  priceLabel: string;
  highlighted: boolean;
  badge?: string;
  ctaLabel?: string;
  ctaAction?: 'trial' | 'contact';
  trialEligible?: boolean;
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
    description: 'Extract load details from documents automatically, reducing manual data entry.',
    details: [
      'Upload broker confirmations, rate cons, and emailed PDFs into one intake queue where AI extracts the shipment details for dispatch review.',
      'Operations teams can compare extracted values against the source document, approve changes quickly, and push clean load records into the workflow.',
      'This reduces retyping, speeds up order creation, and helps prevent costly mistakes around appointment times, pay, and locations.'
    ],
    capabilities: [
      'AI extraction for pickup, delivery, rate, commodity, and stops',
      'Human review queue before dispatch release',
      'Document-to-load linkage for auditability',
      'Exception flags for missing or low-confidence fields'
    ],
    mock: {
      navLabel: 'Intake Console',
      title: 'Incoming load documents',
      subtitle: 'AI turns broker paperwork into ready-to-review load records.',
      insight: 'AI matched broker confirmation to carrier profile and extracted 6 key fields with 98% confidence.',
      metrics: [
        { label: 'Docs queued', value: '18', tone: 'blue' },
        { label: 'Auto-extracted', value: '14', tone: 'green' },
        { label: 'Needs review', value: '4', tone: 'amber' }
      ],
      rows: [
        { status: 'Ready', tone: 'green', primary: 'BOL-4821 · Dallas → Atlanta', secondary: 'Pickup 08:00 · Rate $2,400', meta: '6 fields extracted' },
        { status: 'Review', tone: 'amber', primary: 'Rate Con · Chicago → Memphis', secondary: 'Missing receiver appt time', meta: '1 flagged field' },
        { status: 'Queued', tone: 'blue', primary: 'Broker PDF · Nashville → Houston', secondary: 'Awaiting dispatcher approval', meta: 'New upload' }
      ]
    }
  },
  {
    icon: 'local_shipping',
    title: 'Dispatch Management',
    description: 'Track loads, assignments, statuses, and driver visibility across your fleet.',
    details: [
      'Dispatch teams can manage the full movement lifecycle from intake to delivery with centralized load statuses, driver assignment, and communication context.',
      'The board gives visibility into active trips, appointment risk, and status bottlenecks so dispatchers can react before issues become service failures.',
      'As operations scale, FleetNeuron keeps dispatch workflows standardized across planners, dispatchers, and company entities.'
    ],
    capabilities: [
      'Live dispatch board with assignment and status tracking',
      'Driver, tractor, and trailer visibility on each load',
      'Status milestones from dispatched to delivered',
      'Multi-MC oversight for shared dispatch organizations'
    ],
    mock: {
      navLabel: 'Dispatch Board',
      title: 'Today’s dispatch operations',
      subtitle: 'Track active trips, assignments, and at-risk loads in one board.',
      insight: '2 loads are approaching appointment risk; one can be recovered by swapping to a nearby driver.',
      metrics: [
        { label: 'Active loads', value: '24', tone: 'green' },
        { label: 'Drivers on road', value: '18', tone: 'teal' },
        { label: 'At-risk loads', value: '2', tone: 'amber' }
      ],
      rows: [
        { status: 'Transit', tone: 'blue', primary: 'Chicago → Dallas · M. Torres', secondary: 'Truck 271 · ETA 14:10', meta: 'Multi-MC shared board' },
        { status: 'Assigned', tone: 'amber', primary: 'Detroit → Nashville · K. Williams', secondary: 'Waiting on pickup check-in', meta: 'MC 2041' },
        { status: 'Delivered', tone: 'green', primary: 'Memphis → Atlanta · R. Johnson', secondary: 'POD received', meta: 'Ready to settle' }
      ]
    }
  },
  {
    icon: 'badge',
    title: 'Driver & DQF Management',
    description: 'Organize drivers, onboarding, compliance records, and qualification files.',
    details: [
      'Keep driver records, qualification files, onboarding packets, and required documents in one structured workflow.',
      'Managers can see what is missing, what is expiring soon, and what actions are needed before a driver is road-ready.',
      'This creates a cleaner compliance process while giving operations and safety a shared view of driver readiness.'
    ],
    capabilities: [
      'Driver qualification file tracking',
      'Onboarding packet delivery and completion visibility',
      'Expiration monitoring for licenses and medical cards',
      'Centralized driver profile and document history'
    ],
    mock: {
      navLabel: 'Driver Hub',
      title: 'Driver readiness dashboard',
      subtitle: 'See which drivers are complete, expiring, or blocked from dispatch.',
      insight: '3 driver files need action this week: 2 medical cards expiring and 1 missing road-test document.',
      metrics: [
        { label: 'Active drivers', value: '43', tone: 'green' },
        { label: 'Expiring docs', value: '5', tone: 'amber' },
        { label: 'Packets sent', value: '9', tone: 'blue' }
      ],
      rows: [
        { status: 'Complete', tone: 'green', primary: 'A. Smith · DQF current', secondary: 'CDL, medical, MVR on file', meta: 'Eligible for dispatch' },
        { status: 'Attention', tone: 'amber', primary: 'L. Gomez · Medical card', secondary: 'Expires in 7 days', meta: 'Safety follow-up' },
        { status: 'Onboarding', tone: 'blue', primary: 'J. Carter · New hire packet', secondary: '6 of 8 steps complete', meta: 'Awaiting signatures' }
      ]
    }
  },
  {
    icon: 'security',
    title: 'Safety & Compliance',
    description: 'Track incidents, violations, reminders, and compliance actions in one place.',
    details: [
      'Safety teams can log events, follow corrective actions, and monitor upcoming obligations without relying on disconnected spreadsheets.',
      'The system helps tie incidents, driver actions, and reminders together so follow-up is visible and measurable.',
      'This makes it easier to maintain a defensible compliance process and reduce missed tasks.'
    ],
    capabilities: [
      'Violation and incident tracking',
      'Corrective action workflows',
      'Compliance reminders and due dates',
      'Shared safety visibility across operating entities'
    ],
    mock: {
      navLabel: 'Safety Center',
      title: 'Safety action queue',
      subtitle: 'Prioritize incidents, renewals, and follow-up work from one console.',
      insight: 'Two unresolved violations are linked to drivers already scheduled this week; notify dispatch before assignment.',
      metrics: [
        { label: 'Open cases', value: '7', tone: 'amber' },
        { label: 'Resolved this month', value: '22', tone: 'green' },
        { label: 'Due this week', value: '4', tone: 'blue' }
      ],
      rows: [
        { status: 'Open', tone: 'amber', primary: 'HOS violation follow-up', secondary: 'Driver: M. Howard · Due tomorrow', meta: 'Needs acknowledgement' },
        { status: 'Closed', tone: 'green', primary: 'Accident review complete', secondary: 'Corrective action signed', meta: 'Archived' },
        { status: 'Scheduled', tone: 'blue', primary: 'Annual review reminders', secondary: '4 drivers due this week', meta: 'Batch workflow ready' }
      ]
    }
  },
  {
    icon: 'build',
    title: 'Maintenance & Work Orders',
    description: 'Manage repairs, shops, service history, and technician workflows.',
    details: [
      'Maintenance teams can create work orders, track labor and parts, and see unit status across trucks and trailers.',
      'Service history stays attached to each asset so managers can identify repeat issues and plan preventive work.',
      'This supports both internal shop workflows and external vendor coordination from the same system.'
    ],
    capabilities: [
      'Work order creation and assignment',
      'Unit service history and issue tracking',
      'Labor, parts, and status updates in one workflow',
      'Preventive maintenance planning support'
    ],
    mock: {
      navLabel: 'Work Orders',
      title: 'Maintenance control board',
      subtitle: 'Track unit issues, repair stages, and shop throughput.',
      insight: 'Truck 271 has repeat cooling system repairs; AI flagged it for deeper diagnosis before the next long-haul dispatch.',
      metrics: [
        { label: 'Open work orders', value: '6', tone: 'amber' },
        { label: 'Units in shop', value: '4', tone: 'blue' },
        { label: 'Completed today', value: '3', tone: 'green' }
      ],
      rows: [
        { status: 'In shop', tone: 'blue', primary: 'Truck 271 · Cooling system', secondary: 'Technician: D. Hall', meta: 'Awaiting parts' },
        { status: 'Queued', tone: 'amber', primary: 'Trailer 918 · Brake inspection', secondary: 'PM interval reached', meta: 'Priority medium' },
        { status: 'Complete', tone: 'green', primary: 'Truck 190 · Oil service', secondary: 'Released back to fleet', meta: 'Closed today' }
      ]
    }
  },
  {
    icon: 'inventory_2',
    title: 'Parts & Inventory',
    description: 'Handle receiving, stock, transfers, and parts visibility across your operation.',
    details: [
      'Manage part receipts, stock levels, transfers, and usage visibility across your locations or operating entities.',
      'Inventory events stay connected to work orders and receiving workflows so the team knows where parts were used and when to reorder.',
      'This gives maintenance and purchasing cleaner control over critical inventory items.'
    ],
    capabilities: [
      'Receiving and stock entry workflows',
      'Location-aware part visibility',
      'Transfers between shops or companies',
      'Low-stock monitoring for critical items'
    ],
    mock: {
      navLabel: 'Inventory',
      title: 'Parts visibility across locations',
      subtitle: 'Track stock, receiving, and transfers without losing asset history.',
      insight: 'Brake chamber inventory is low at Dallas; transfer 8 units from Memphis to avoid delayed repairs.',
      metrics: [
        { label: 'SKUs tracked', value: '1.2k', tone: 'blue' },
        { label: 'Low stock alerts', value: '11', tone: 'amber' },
        { label: 'Receipts today', value: '5', tone: 'green' }
      ],
      rows: [
        { status: 'Low', tone: 'amber', primary: 'Brake chamber · Dallas', secondary: '4 on hand · Min 12', meta: 'Transfer suggested' },
        { status: 'Received', tone: 'green', primary: 'Oil filters · Memphis', secondary: 'PO 1048 posted to stock', meta: '+36 units' },
        { status: 'Transfer', tone: 'blue', primary: 'Tire sensors · Atlanta → Dallas', secondary: 'In transit between shops', meta: '12 units' }
      ]
    }
  },
  {
    icon: 'domain',
    title: 'Multi-Company Operations',
    description: 'Manage one company or multiple MC/business entities under a single platform.',
    details: [
      'FleetNeuron supports multi-MC and multi-company structures so groups can run shared operations while preserving entity-level access and reporting boundaries.',
      'Admins can control what users see by company, while leadership gains a centralized operational view across the organization.',
      'This is ideal for holding companies, family fleets, and businesses with shared dispatch or safety resources.'
    ],
    capabilities: [
      'Multiple MC and business entity support',
      'Company-aware user permissions',
      'Cross-company operational visibility',
      'Centralized admin controls with scoped access'
    ],
    mock: {
      navLabel: 'Multi-MC Admin',
      title: 'Shared operations with company controls',
      subtitle: 'Give users the right visibility across one or many operating entities.',
      insight: 'Dispatch supervisors can see all 3 MCs, while accounting users remain limited to their assigned entities.',
      metrics: [
        { label: 'Operating entities', value: '3', tone: 'blue' },
        { label: 'Shared users', value: '12', tone: 'teal' },
        { label: 'Scoped roles', value: '28', tone: 'green' }
      ],
      rows: [
        { status: 'Active', tone: 'green', primary: 'Goodmen Transport · MC 2041', secondary: 'Dispatch, safety, accounting enabled', meta: 'Core entity' },
        { status: 'Shared', tone: 'blue', primary: 'Regional Logistics · MC 4418', secondary: 'Uses shared dispatch team', meta: 'Cross-company visibility' },
        { status: 'Restricted', tone: 'amber', primary: 'Broker Ops entity', secondary: 'Accounting-only access group', meta: 'Scoped permissions' }
      ]
    }
  },
  {
    icon: 'psychology',
    title: 'Smart AI Assistance',
    description: 'Reduce manual work and improve operational speed with built-in AI workflows.',
    details: [
      'AI features help teams move faster by summarizing issues, suggesting next actions, and reducing the burden of repetitive operational review.',
      'Instead of hunting through multiple screens, users can get context-aware assistance directly in the application.',
      'This improves response times while keeping people in control of operational decisions.'
    ],
    capabilities: [
      'Context-aware assistant inside the app',
      'Workflow suggestions and operational summaries',
      'AI-supported troubleshooting and navigation',
      'Expandable automation opportunities over time'
    ],
    mock: {
      navLabel: 'AI Console',
      title: 'Operational AI assistant',
      subtitle: 'Give dispatch, safety, and maintenance teams faster answers and next steps.',
      insight: 'Assistant prepared a load-risk summary and suggested reassigning a driver with nearby availability.',
      metrics: [
        { label: 'Suggestions today', value: '31', tone: 'green' },
        { label: 'Teams using AI', value: '4', tone: 'blue' },
        { label: 'Avg response', value: '2.4s', tone: 'teal' }
      ],
      rows: [
        { status: 'Ready', tone: 'green', primary: 'Summarize dispatch delays', secondary: 'AI found 3 at-risk loads', meta: 'Suggested actions available' },
        { status: 'Live', tone: 'blue', primary: 'Guide user to work orders', secondary: 'Navigation + troubleshooting help', meta: 'In-app assistant' },
        { status: 'Queued', tone: 'amber', primary: 'Compliance reminder draft', secondary: 'Review before send', meta: 'Human approval' }
      ]
    }
  },
  {
    icon: 'payments',
    title: 'Accounting Workflow Support',
    description: 'Support settlements, payroll-related operations, and cost visibility.',
    details: [
      'Accounting-related workflows can stay closer to operations by tying settlements, load revenue, and operational costs back to the work being performed.',
      'This reduces handoffs between departments and gives managers better visibility into what has been completed versus what is ready for settlement.',
      'It is especially useful for fleets that want tighter coordination between dispatch and back office teams.'
    ],
    capabilities: [
      'Settlement workflow support',
      'Operational cost and load-revenue visibility',
      'Cross-team readiness tracking before payout',
      'Aligned dispatch-to-accounting handoff'
    ],
    mock: {
      navLabel: 'Settlement View',
      title: 'Operational accounting workflow',
      subtitle: 'Track what is ready for settlement and what still needs review.',
      insight: '4 delivered loads are settlement-ready after POD validation; 1 is waiting on accessorial confirmation.',
      metrics: [
        { label: 'Ready to settle', value: '4', tone: 'green' },
        { label: 'Pending review', value: '3', tone: 'amber' },
        { label: 'This week value', value: '$18.4k', tone: 'blue' }
      ],
      rows: [
        { status: 'Ready', tone: 'green', primary: 'Load 4821 · Driver pay packet', secondary: 'POD + rate verified', meta: 'Approve payout' },
        { status: 'Pending', tone: 'amber', primary: 'Load 4912 · Accessorial review', secondary: 'Lumpered receipt missing', meta: 'Accounting follow-up' },
        { status: 'Posted', tone: 'blue', primary: 'Weekly settlement batch', secondary: '8 records exported', meta: 'Completed' }
      ]
    }
  },
  {
    icon: 'smartphone',
    title: 'Mobile-Friendly Access',
    description: 'Enable teams to work from anywhere with a responsive, modern interface.',
    details: [
      'Teams in the field can access important workflows from mobile-friendly screens without needing the full desktop experience.',
      'This helps dispatchers, drivers, safety users, and shop personnel complete key tasks faster from wherever work happens.',
      'A responsive public and app experience also makes onboarding and quick status checks easier on smaller devices.'
    ],
    capabilities: [
      'Responsive app layouts for field teams',
      'Mobile-friendly onboarding and review screens',
      'Fast access to key operational actions',
      'Consistent experience across desktop and tablet/mobile'
    ],
    mock: {
      navLabel: 'Mobile View',
      title: 'Anywhere-access workflow screen',
      subtitle: 'Give teams a practical mobile experience for quick operational work.',
      insight: 'Field users complete packet reviews 34% faster when workflows are optimized for smaller screens.',
      metrics: [
        { label: 'Mobile sessions', value: '62%', tone: 'blue' },
        { label: 'Tasks completed', value: '128', tone: 'green' },
        { label: 'Avg tap flow', value: '3 steps', tone: 'teal' }
      ],
      rows: [
        { status: 'Live', tone: 'blue', primary: 'Driver onboarding review', secondary: 'Phone-optimized form steps', meta: 'Public link ready' },
        { status: 'Complete', tone: 'green', primary: 'Shop status update', secondary: 'Work order updated from tablet', meta: 'Saved instantly' },
        { status: 'Queued', tone: 'amber', primary: 'Dispatch note approval', secondary: 'Awaiting supervisor tap', meta: 'Mobile approval flow' }
      ]
    }
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
    name: 'Starter',
    tagline: 'Essential fleet operations',
    description:
      'Includes dashboard, dispatch, compliance, and settlement workflows for one operating entity.',
    priceLabel: '$149/mo',
    highlighted: false,
    ctaLabel: 'Start Free Trial',
    ctaAction: 'trial',
    trialEligible: true,
    features: [
      { text: 'Dashboard, Loads, Dispatch Board, Drivers' },
      { text: 'Trucks/Trailers, HOS, DQF, Audit' },
      { text: 'Settlements: Scheduled Payments + Equipment Owners' },
      { text: 'Best for growing single-entity fleets', highlight: true }
    ]
  },
  {
    id: 'multi_mc',
    name: 'Professional',
    tagline: 'Multi-entity control and scale',
    description:
      'Everything in Basic plus multi-entity administration and broader role coverage.',
    priceLabel: '$349/mo',
    highlighted: true,
    badge: 'Most Popular',
    ctaLabel: 'Start Free Trial',
    ctaAction: 'trial',
    trialEligible: true,
    features: [
      { text: 'Everything in Basic' },
      { text: 'Multi-entity admin page (/admin/multi-mc)', highlight: true },
      { text: 'Cross-entity operational management' },
      { text: 'Best for teams running multiple MCs', highlight: true }
    ]
  },
  {
    id: 'end_to_end',
    name: 'Advanced',
    tagline: 'Full platform, maximum coverage',
    description:
      'Everything in Multi-MC plus inventory, accounting, reports, and roadside AI with larger user access.',
    priceLabel: '$799/mo',
    highlighted: false,
    ctaLabel: 'Start Free Trial',
    ctaAction: 'trial',
    trialEligible: true,
    features: [
      { text: 'Everything in Multi-MC' },
      { text: 'Inventory modules + accounting (invoices/settlements)' },
      { text: 'Reports + Roadside AI', highlight: true },
      { text: 'Built for high-volume operations', highlight: true }
    ]
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'Tailored architecture and support',
    description:
      'Custom implementation, onboarding, and integrations for complex operations.',
    priceLabel: "Let's talk",
    highlighted: false,
    ctaLabel: "Let's Talk",
    ctaAction: 'contact',
    trialEligible: false,
    features: [
      { text: 'Custom onboarding and migration support' },
      { text: 'Dedicated success and solution engineering', highlight: true },
      { text: 'Tailored integrations and workflows' }
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
