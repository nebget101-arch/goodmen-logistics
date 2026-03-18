const fs = require('fs');
const path = require('path');
const handlebars = require('handlebars');
const emailService = require('./emailService');

/**
 * Trial Email Service
 * Handles all trial lifecycle email communications
 */
class TrialEmailService {
  constructor() {
    this.templatesDir = path.join(__dirname, 'templates', 'trial');
    this.templates = {};
    this.loadTemplates();
  }

  /**
   * Load all trial email templates
   */
  loadTemplates() {
    const templateFiles = [
      'trial-started.html',
      'trial-ending-soon.html',
      'trial-ended.html',
      'payment-failed.html',
      'data-expiring-soon.html',
      'conversion-successful.html',
      'account-paused.html',
      'account-reactivated.html'
    ];

    templateFiles.forEach(file => {
      const filePath = path.join(this.templatesDir, file);
      const key = file.replace('.html', '');
      
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        this.templates[key] = handlebars.compile(content);
      } else {
        console.warn(`Template not found: ${file}`);
      }
    });
  }

  /**
   * Send trial started email
   */
  async sendTrialStartedEmail(tenant, options = {}) {
    const subject = `Welcome to FleetNeuron - Your ${options.trialDays || 14}-Day Free Trial`;
    
    const htmlContent = this.templates['trial-started'](this.buildTemplateData({
      tenantName: tenant.name,
      trialDays: options.trialDays || 14,
      trialEndDate: this.formatDate(options.trialEndDate),
      trialEndTime: this.formatTime(options.trialEndDate),
      dashboardUrl: `${process.env.APP_URL}/dashboard`,
      gettingStartedUrl: `${process.env.APP_URL}/docs/getting-started`,
      videoTutorialsUrl: `${process.env.APP_URL}/docs/videos`,
      integrationDocsUrl: `${process.env.APP_URL}/docs/integrations`,
      contactSalesUrl: `${process.env.APP_URL}/contact-sales`,
      supportEmail: process.env.SUPPORT_EMAIL || 'support@fleetneuron.com'
    }));

    return this.sendEmail(tenant.email, subject, htmlContent, {
      emailType: 'trial_started',
      tenantId: tenant.id
    });
  }

  /**
   * Send trial ending soon reminder
   */
  async sendTrialEndingSoonEmail(tenant, options = {}) {
    const subject = `Your FleetNeuron Trial Ends in ${options.daysRemaining} Days`;
    
    const htmlContent = this.templates['trial-ending-soon'](this.buildTemplateData({
      tenantName: tenant.name,
      daysRemaining: options.daysRemaining,
      usedFeatures: options.usedFeatures || 'core',
      accountStatus: tenant.status || 'active',
      daysUsed: options.daysUsed || options.trialDays,
      upgradeUrl: `${process.env.APP_URL}/billing/upgrade`,
      contactSalesUrl: `${process.env.APP_URL}/contact-sales`
    }));

    return this.sendEmail(tenant.email, subject, htmlContent, {
      emailType: 'trial_ending_soon',
      daysRemaining: options.daysRemaining,
      tenantId: tenant.id
    });
  }

  /**
   * Send trial ended notification
   */
  async sendTrialEndedEmail(tenant, options = {}) {
    const subject = 'Your FleetNeuron Trial Has Ended';
    
    const htmlContent = this.templates['trial-ended'](this.buildTemplateData({
      tenantName: tenant.name,
      dataRetentionDays: options.dataRetentionDays || 30,
      dataExpiryDate: this.formatDate(options.dataExpiryDate),
      upgradeUrl: `${process.env.APP_URL}/billing/upgrade`,
      contactSalesUrl: `${process.env.APP_URL}/contact-sales`
    }));

    return this.sendEmail(tenant.email, subject, htmlContent, {
      emailType: 'trial_ended',
      tenantId: tenant.id
    });
  }

  /**
   * Send payment failed notification
   */
  async sendPaymentFailedEmail(tenant, options = {}) {
    const subject = 'Payment Failed - Update Your Payment Method';
    
    const htmlContent = this.templates['payment-failed'](this.buildTemplateData({
      tenantName: tenant.name,
      gracePeriodDays: options.gracePeriodDays || 7,
      gracePeriodEnd: this.formatDate(options.gracePeriodEnd),
      addCardUrl: `${process.env.APP_URL}/account/billing/update-payment`
    }));

    return this.sendEmail(tenant.email, subject, htmlContent, {
      emailType: 'payment_failed',
      tenantId: tenant.id
    });
  }

  /**
   * Send data expiring soon notification
   */
  async sendDataExpiringEmail(tenant, options = {}) {
    const subject = `Your Data Will Expire in ${options.daysUntilExpiry} Days`;
    
    const htmlContent = this.templates['data-expiring-soon'](this.buildTemplateData({
      tenantName: tenant.name,
      daysUntilExpiry: options.daysUntilExpiry,
      daysSinceTrialEnd: options.daysSinceTrialEnd,
      expiryDate: this.formatDate(options.expiryDate),
      recordCount: options.recordCount || 'your',
      historyDays: options.historyDays || 30,
      upgradeUrl: `${process.env.APP_URL}/billing/upgrade`,
      contactSalesUrl: `${process.env.APP_URL}/contact-sales`
    }));

    return this.sendEmail(tenant.email, subject, htmlContent, {
      emailType: 'data_expiring_soon',
      daysRemaining: options.daysUntilExpiry,
      tenantId: tenant.id
    });
  }

  /**
   * Send conversion successful confirmation
   */
  async sendConversionSuccessfulEmail(tenant, subscription, options = {}) {
    const subject = `Welcome to ${subscription.planName} - Your Account is Active`;
    
    const htmlContent = this.templates['conversion-successful'](this.buildTemplateData({
      tenantName: tenant.name,
      planName: subscription.planName,
      monthlyPrice: this.formatPrice(subscription.monthlyPrice),
      billingDate: subscription.billingDate,
      nextRenewalDate: this.formatDate(subscription.nextRenewalDate),
      apiCallLimit: this.formatNumber(subscription.apiCallLimit),
      userCount: subscription.userCount,
      storageAmount: this.formatBytes(subscription.storageAmount),
      dashboardUrl: `${process.env.APP_URL}/dashboard`,
      accountSettingsUrl: `${process.env.APP_URL}/account/settings`,
      supportHours: process.env.SUPPORT_HOURS || '24/7',
      supportEmail: process.env.SUPPORT_EMAIL || 'support@fleetneuron.com'
    }));

    return this.sendEmail(tenant.email, subject, htmlContent, {
      emailType: 'conversion_successful',
      subscriptionId: subscription.id,
      tenantId: tenant.id
    });
  }

  /**
   * Send account paused notification
   */
  async sendAccountPausedEmail(tenant, options = {}) {
    const subject = 'Your Account Has Been Paused - Action Required';
    
    const htmlContent = this.templates['account-paused'](this.buildTemplateData({
      tenantName: tenant.name,
      attemptCount: options.attemptCount || 3,
      gracePeriodDays: options.gracePeriodDays || 7,
      deactivationDate: this.formatDate(options.deactivationDate),
      updatePaymentUrl: `${process.env.APP_URL}/account/billing/update-payment`,
      contactSalesUrl: `${process.env.APP_URL}/contact-sales`,
      supportEmail: process.env.SUPPORT_EMAIL || 'support@fleetneuron.com',
      supportHours: process.env.SUPPORT_HOURS || '24/7'
    }));

    return this.sendEmail(tenant.email, subject, htmlContent, {
      emailType: 'account_paused',
      tenantId: tenant.id
    });
  }

  /**
   * Send account reactivated confirmation
   */
  async sendAccountReactivatedEmail(tenant, options = {}) {
    const subject = 'Your Account Has Been Reactivated - Welcome Back!';
    
    const htmlContent = this.templates['account-reactivated'](this.buildTemplateData({
      tenantName: tenant.name,
      dashboardUrl: `${process.env.APP_URL}/dashboard`,
      accountSettingsUrl: `${process.env.APP_URL}/account/settings`,
      supportEmail: process.env.SUPPORT_EMAIL || 'support@fleetneuron.com'
    }));

    return this.sendEmail(tenant.email, subject, htmlContent, {
      emailType: 'account_reactivated',
      tenantId: tenant.id
    });
  }

  /**
   * Build template data with safe formatting defaults
   */
  buildTemplateData(data) {
    return {
      appUrl: process.env.APP_URL || 'https://fleetneuron.com',
      supportEmail: process.env.SUPPORT_EMAIL || 'support@fleetneuron.com',
      ...data
    };
  }

  /**
   * Format date for display
   */
  formatDate(date) {
    if (!date) return 'TBD';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  }

  /**
   * Format time for display
   */
  formatTime(date) {
    if (!date) return 'TBD';
    const d = new Date(date);
    return d.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      timeZone: 'UTC'
    });
  }

  /**
   * Format price for display
   */
  formatPrice(price) {
    if (!price) return '$0';
    return `$${(price / 100).toFixed(2)}`;
  }

  /**
   * Format number with thousands separator
   */
  formatNumber(num) {
    if (!num) return '0';
    return num.toLocaleString();
  }

  /**
   * Format bytes to human readable format
   */
  formatBytes(bytes) {
    if (!bytes) return '0 GB';
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(1)} GB`;
  }

  /**
   * Send email using the email service
   */
  async sendEmail(toEmail, subject, htmlContent, metadata = {}) {
    try {
      return await emailService.sendEmail({
        to: toEmail,
        subject,
        html: htmlContent,
        metadata
      });
    } catch (error) {
      console.error('Failed to send trial email:', {
        to: toEmail,
        subject,
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = new TrialEmailService();
