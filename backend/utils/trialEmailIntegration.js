const trialEmailService = require('../emails/trialEmailService');
const logger = require('../utils/logger');

/**
 * Trial Email Integration
 * Integrates email sending with trial lifecycle events
 */
class TrialEmailIntegration {
  /**
   * Handle trial started event
   */
  static async onTrialStarted(tenant, trialConfig) {
    try {
      // Check communication preferences
      if (!this.shouldSendEmail(tenant, 'trial_notifications')) {
        logger.debug(`Trial started email skipped for ${tenant.id} (preferences)`);
        return;
      }

      await trialEmailService.sendTrialStartedEmail(tenant, {
        trialDays: trialConfig.trialDays || 14,
        trialEndDate: trialConfig.trialEndDate
      });

      logger.info(`Trial started email sent to ${tenant.email}`);
    } catch (error) {
      logger.error(`Failed to send trial started email to ${tenant.email}:`, error);
      // Don't throw - don't block trial creation on email failure
    }
  }

  /**
   * Handle trial ending soon event (when user visits dashboard)
   */
  static async onTrialEndingSoon(tenant, daysRemaining) {
    try {
      if (!this.shouldSendEmail(tenant, 'trial_reminders')) {
        return;
      }

      // Only send if user hasn't seen this in last 24 hours
      if (!await this.shouldSendReminderEmail(tenant.id, `ending_${daysRemaining}d`)) {
        return;
      }

      await trialEmailService.sendTrialEndingSoonEmail(tenant, {
        daysRemaining,
        trialDays: tenant.trial_days || 14,
        daysUsed: this.calculateDaysUsed(tenant.trial_start_date)
      });

      logger.info(`Trial ending reminder (${daysRemaining}d) sent to ${tenant.email}`);
    } catch (error) {
      logger.error(`Failed to send trial ending email:`, error);
    }
  }

  /**
   * Handle trial ended event
   */
  static async onTrialEnded(tenant, trial) {
    try {
      if (!this.shouldSendEmail(tenant, 'trial_notifications')) {
        return;
      }

      await trialEmailService.sendTrialEndedEmail(tenant, {
        dataRetentionDays: 30,
        dataExpiryDate: this.calculateDataExpiryDate(trial.trialEndDate)
      });

      logger.info(`Trial ended email sent to ${tenant.email}`);
    } catch (error) {
      logger.error(`Failed to send trial ended email:`, error);
    }
  }

  /**
   * Handle payment failed event
   */
  static async onPaymentFailed(tenant, paymentAttempt) {
    try {
      if (!this.shouldSendEmail(tenant, 'trial_notifications')) {
        return;
      }

      const gracePeriod = 7; // days
      const gracePeriodEnd = new Date();
      gracePeriodEnd.setDate(gracePeriodEnd.getDate() + gracePeriod);

      await trialEmailService.sendPaymentFailedEmail(tenant, {
        gracePeriodDays: gracePeriod,
        gracePeriodEnd
      });

      logger.info(`Payment failed email sent to ${tenant.email}`);
    } catch (error) {
      logger.error(`Failed to send payment failed email:`, error);
    }
  }

  /**
   * Handle conversion event
   */
  static async onConversion(tenant, subscription) {
    try {
      if (!this.shouldSendEmail(tenant, 'trial_notifications')) {
        return;
      }

      await trialEmailService.sendConversionSuccessfulEmail(tenant, subscription, {
        billingDate: subscription.billingDate,
        nextRenewalDate: subscription.nextRenewalDate
      });

      logger.info(`Conversion successful email sent to ${tenant.email}`);
    } catch (error) {
      logger.error(`Failed to send conversion email:`, error);
    }
  }

  /**
   * Handle account paused event
   */
  static async onAccountPaused(tenant, pauseReason) {
    try {
      if (!this.shouldSendEmail(tenant, 'trial_notifications')) {
        return;
      }

      const gracePeriod = 7; // days
      const deactivationDate = new Date();
      deactivationDate.setDate(deactivationDate.getDate() + gracePeriod);

      await trialEmailService.sendAccountPausedEmail(tenant, {
        attemptCount: pauseReason.paymentAttempts || 3,
        gracePeriodDays: gracePeriod,
        deactivationDate,
        reason: pauseReason.reason
      });

      logger.info(`Account paused email sent to ${tenant.email}`);
    } catch (error) {
      logger.error(`Failed to send account paused email:`, error);
    }
  }

  /**
   * Handle account reactivated event
   */
  static async onAccountReactivated(tenant) {
    try {
      if (!this.shouldSendEmail(tenant, 'trial_notifications')) {
        return;
      }

      await trialEmailService.sendAccountReactivatedEmail(tenant);

      logger.info(`Account reactivated email sent to ${tenant.email}`);
    } catch (error) {
      logger.error(`Failed to send account reactivated email:`, error);
    }
  }

  /**
   * Check if email should be sent based on user preferences
   */
  static shouldSendEmail(tenant, preferenceType) {
    if (!tenant.email) {
      logger.warn(`Tenant ${tenant.id} has no email on file`);
      return false;
    }

    const preferences = tenant.email_preferences || {};
    const setting = preferences[preferenceType];

    // Default to true (send) unless explicitly false
    return setting !== 'false';
  }

  /**
   * Check if reminder email should be sent (rate limiting)
   */
  static async shouldSendReminderEmail(tenantId, reminderKey) {
    // This would check if the email was already sent recently
    // Implementation depends on your database schema
    // For now, return true
    return true;
  }

  /**
   * Calculate days used
   */
  static calculateDaysUsed(trialStartDate) {
    const now = new Date();
    const start = new Date(trialStartDate);
    const diff = now.getTime() - start.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  /**
   * Calculate data expiry date
   */
  static calculateDataExpiryDate(trialEndDate) {
    const end = new Date(trialEndDate);
    end.setDate(end.getDate() + 30);
    return end;
  }
}

module.exports = TrialEmailIntegration;
