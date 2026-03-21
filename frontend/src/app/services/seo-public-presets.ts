import { SeoConfig } from './seo.service';

/** Strongly typed map so TS allows `SEO_PUBLIC.home` etc. (avoids index-signature-only access). */
export interface SeoPublicPresets {
  home: SeoConfig;
  trial: SeoConfig;
  trialSignup: SeoConfig;
  contact: SeoConfig;
  login: SeoConfig;
  forgotPassword: SeoConfig;
  resetPassword: SeoConfig;
  privacy: SeoConfig;
  terms: SeoConfig;
  communicationPreferences: SeoConfig;
  driverOnboarding: SeoConfig;
  publicRoadside: SeoConfig;
}

/** Preset SEO configs for public (unauthenticated) routes — FN-1. */
export const SEO_PUBLIC: SeoPublicPresets = {
  home: {
    title: 'FleetNeuron AI — FMCSA Compliance, Dispatch & Fleet Operations',
    description:
      'Fleet management and FMCSA compliance software for motor carriers: driver qualification, HOS, maintenance, loads, safety, and AI-assisted workflows. Start a trial or book a demo.',
    path: '/home'
  },
  trial: {
    title: 'Start a Trial — FleetNeuron AI',
    description:
      'Request a FleetNeuron AI trial for your fleet. FMCSA-aligned tools for compliance, dispatch, maintenance, and operations—tell us about your carrier and we will follow up.',
    path: '/home/trial'
  },
  trialSignup: {
    title: 'Complete Trial Signup — FleetNeuron AI',
    description:
      'Finish setting up your FleetNeuron AI trial account. Create your login and start using fleet compliance and operations tools.',
    path: '/home/trial-signup'
  },
  contact: {
    title: 'Contact Us — FleetNeuron AI',
    description:
      'Contact FleetNeuron AI for sales, demos, and product questions. We help carriers modernize compliance, dispatch, and fleet operations.',
    path: '/home/contact'
  },
  login: {
    title: 'Sign In — FleetNeuron AI',
    description: 'Sign in to FleetNeuron AI to manage your fleet, compliance, dispatch, and safety workflows.',
    path: '/login'
  },
  forgotPassword: {
    title: 'Forgot Password — FleetNeuron AI',
    description:
      'Reset your FleetNeuron AI account password. Enter your email to receive a secure reset link.',
    path: '/forgot-password'
  },
  resetPassword: {
    title: 'Reset Password — FleetNeuron AI',
    description: 'Choose a new password for your FleetNeuron AI account.',
    path: '/reset-password'
  },
  privacy: {
    title: 'Privacy Policy — FleetNeuron AI',
    description:
      'How FleetNeuron AI collects, uses, and protects personal information for fleet operators, drivers, and applicants—including communications and payment processing.',
    path: '/privacy'
  },
  terms: {
    title: 'Terms and Conditions — FleetNeuron AI',
    description:
      'Terms of use for FleetNeuron AI services, including accounts, billing, acceptable use, and compliance responsibilities for fleet customers.',
    path: '/terms'
  },
  communicationPreferences: {
    title: 'Communication Preferences — FleetNeuron AI',
    description:
      'Update your email and SMS communication preferences for FleetNeuron AI operational and marketing messages.',
    path: '/communication-preferences'
  },
  driverOnboarding: {
    title: 'Driver Onboarding — FleetNeuron AI',
    description:
      'Complete your driver onboarding steps for your carrier using FleetNeuron AI. This link is private to your invitation.',
    path: '/onboard',
    noindex: true
  },
  publicRoadside: {
    title: 'Roadside Assistance — FleetNeuron AI',
    description:
      'Share context and location with your fleet’s roadside assistance workflow. This link is specific to your service call.',
    path: '/roadside',
    noindex: true
  }
};
