const cron = require('node-cron');
const logger = require('../utils/logger');
const trialEmailService = require('../emails/trialEmailService');
const db = require('../database');

/**
 * Trial Reminder Service
 * Sends periodic email reminders during trial lifecycle
 */
class SendTrialReminders {
  constructor() {
    this.schedule = null;
    this.isRunning = false;
  }

  /**
   * Start the trial reminder cron job
   * Runs daily at 2 AM UTC
   */
  start() {
    if (this.isRunning) {
      logger.warn('Trial reminder service is already running');
      return;
    }

    // Run daily at 2 AM UTC
    this.schedule = cron.schedule('0 2 * * *', async () => {
      logger.info('Starting trial reminder check...');
      await this.processReminders();
    });

    this.isRunning = true;
    logger.info('Trial reminder service started (runs daily at 2 AM UTC)');
  }

  /**
   * Stop the trial reminder cron job
   */
  stop() {
    if (this.schedule) {
      this.schedule.stop();
      this.isRunning = false;
      logger.info('Trial reminder service stopped');
    }
  }

  /**
   * Process all trial reminders
   */
  async processReminders() {
    try {
      // Get tenants needing reminders
      const [
        sevenDayReminders,
        threeDayReminders,
        oneDayReminders,
        trialEndedNotifications,
        dataExpiringNotifications
      ] = await Promise.all([
        this.getTenantsFor7DayReminder(),
        this.getTenantsFor3DayReminder(),
        this.getTenantsFor1DayReminder(),
        this.getTenantsWithExpiredTrials(),
        this.getTenantsWithExpiringData()
      ]);

      logger.info('Trial reminder counts:', {
        sevenDay: sevenDayReminders.length,
        threeDay: threeDayReminders.length,
        oneDay: oneDayReminders.length,
        trialEnded: trialEndedNotifications.length,
        dataExpiring: dataExpiringNotifications.length
      });

      // Send reminders
      await Promise.all([
        this.sendReminders(sevenDayReminders, 'seven_day'),
        this.sendReminders(threeDayReminders, 'three_day'),
        this.sendReminders(oneDayReminders, 'one_day'),
        this.sendTrialEndedNotifications(trialEndedNotifications),
        this.sendDataExpiringNotifications(dataExpiringNotifications)
      ]);

      logger.info('Trial reminder processing completed successfully');
    } catch (error) {
      logger.error('Error processing trial reminders:', error);
    }
  }

  /**
   * Get tenants that should receive 7-day reminder
   * (Trial ends in 6-8 days)
   */
  async getTenantsFor7DayReminder() {
    const query = `
      SELECT t.*, ts.trial_end_date
      FROM tenants t
      JOIN trial_status ts ON t.id = ts.tenant_id
      WHERE ts.status = 'active'
        AND ts.trial_end_date > NOW()
        AND ts.trial_end_date <= NOW() + INTERVAL 8 DAY
        AND ts.trial_end_date >= NOW() + INTERVAL 6 DAY
        AND (ts.last_reminder_7d IS NULL 
             OR ts.last_reminder_7d < DATE(NOW() - INTERVAL 1 DAY))
        AND ts.email_preferences->>'trial_reminders' != 'false'
    `;
    
    return db.query(query);
  }

  /**
   * Get tenants that should receive 3-day reminder
   * (Trial ends in 2-4 days)
   */
  async getTenantsFor3DayReminder() {
    const query = `
      SELECT t.*, ts.trial_end_date
      FROM tenants t
      JOIN trial_status ts ON t.id = ts.tenant_id
      WHERE ts.status = 'active'
        AND ts.trial_end_date > NOW()
        AND ts.trial_end_date <= NOW() + INTERVAL 4 DAY
        AND ts.trial_end_date >= NOW() + INTERVAL 2 DAY
        AND (ts.last_reminder_3d IS NULL 
             OR ts.last_reminder_3d < DATE(NOW() - INTERVAL 1 DAY))
        AND ts.email_preferences->>'trial_reminders' != 'false'
    `;
    
    return db.query(query);
  }

  /**
   * Get tenants that should receive 1-day reminder
   * (Trial ends tomorrow)
   */
  async getTenantsFor1DayReminder() {
    const query = `
      SELECT t.*, ts.trial_end_date
      FROM tenants t
      JOIN trial_status ts ON t.id = ts.tenant_id
      WHERE ts.status = 'active'
        AND ts.trial_end_date > NOW()
        AND ts.trial_end_date <= NOW() + INTERVAL 1 DAY + INTERVAL 23 HOUR
        AND ts.trial_end_date >= NOW() + INTERVAL 23 HOUR
        AND (ts.last_reminder_1d IS NULL 
             OR ts.last_reminder_1d < DATE(NOW() - INTERVAL 1 DAY))
        AND ts.email_preferences->>'trial_reminders' != 'false'
    `;
    
    return db.query(query);
  }

  /**
   * Get tenants whose trials have ended
   */
  async getTenantsWithExpiredTrials() {
    const query = `
      SELECT t.*, ts.trial_end_date
      FROM tenants t
      JOIN trial_status ts ON t.id = ts.tenant_id
      WHERE ts.status = 'active'
        AND ts.trial_end_date <= NOW()
        AND (ts.last_trial_ended_email_sent IS NULL 
             OR ts.last_trial_ended_email_sent < DATE(NOW() - INTERVAL 1 DAY))
        AND ts.email_preferences->>'trial_notifications' != 'false'
    `;
    
    return db.query(query);
  }

  /**
   * Get tenants whose data is expiring soon
   * (Data expires in 1-3 days)
   */
  async getTenantsWithExpiringData() {
    const query = `
      SELECT t.*, ts.data_expiry_date
      FROM tenants t
      JOIN trial_status ts ON t.id = ts.tenant_id
      WHERE ts.status IN ('expired', 'paused')
        AND ts.data_expiry_date > NOW()
        AND ts.data_expiry_date <= NOW() + INTERVAL 3 DAY
        AND ts.data_expiry_date >= NOW() + INTERVAL 1 DAY
        AND (ts.last_data_expiring_email_sent IS NULL 
             OR ts.last_data_expiring_email_sent < DATE(NOW() - INTERVAL 1 DAY))
        AND ts.email_preferences->>'trial_notifications' != 'false'
    `;
    
    return db.query(query);
  }

  /**
   * Send reminder emails to batch of tenants
   */
  async sendReminders(tenants, reminderType) {
    if (tenants.length === 0) return;

    const results = {
      sent: 0,
      failed: 0,
      errors: []
    };

    for (const tenant of tenants) {
      try {
        const daysRemaining = this.calculateDaysRemaining(tenant.trial_end_date);
        
        await trialEmailService.sendTrialEndingSoonEmail(tenant, {
          daysRemaining,
          trialDays: tenant.trial_days || 14,
          daysUsed: this.calculateDaysUsed(tenant.trial_start_date),
          usedFeatures: this.getUsedFeatures(tenant.id)
        });

        // Mark reminder as sent
        await this.updateReminderSent(tenant.id, reminderType);
        results.sent++;
        
      } catch (error) {
        results.failed++;
        results.errors.push({
          tenantId: tenant.id,
          tenantEmail: tenant.email,
          error: error.message
        });
        logger.error(`Failed to send ${reminderType} reminder to tenant ${tenant.id}:`, error);
      }
    }

    logger.info(`${reminderType} reminder results:`, results);
  }

  /**
   * Send trial ended notifications
   */
  async sendTrialEndedNotifications(tenants) {
    if (tenants.length === 0) return;

    const results = {
      sent: 0,
      failed: 0
    };

    for (const tenant of tenants) {
      try {
        await trialEmailService.sendTrialEndedEmail(tenant, {
          dataRetentionDays: 30,
          dataExpiryDate: this.calculateDataExpiryDate(tenant.trial_end_date)
        });

        await db.query(
          'UPDATE trial_status SET last_trial_ended_email_sent = NOW() WHERE tenant_id = $1',
          [tenant.id]
        );

        results.sent++;
      } catch (error) {
        results.failed++;
        logger.error(`Failed to send trial ended email to tenant ${tenant.id}:`, error);
      }
    }

    logger.info('Trial ended notification results:', results);
  }

  /**
   * Send data expiring notifications
   */
  async sendDataExpiringNotifications(tenants) {
    if (tenants.length === 0) return;

    const results = {
      sent: 0,
      failed: 0
    };

    for (const tenant of tenants) {
      try {
        const daysUntilExpiry = this.calculateDaysRemaining(tenant.data_expiry_date);
        
        await trialEmailService.sendDataExpiringEmail(tenant, {
          daysUntilExpiry,
          daysSinceTrialEnd: this.calculateDaysSinceTrialEnd(tenant.trial_end_date),
          expiryDate: tenant.data_expiry_date,
          recordCount: await this.getRecordCount(tenant.id),
          historyDays: 30
        });

        await db.query(
          'UPDATE trial_status SET last_data_expiring_email_sent = NOW() WHERE tenant_id = $1',
          [tenant.id]
        );

        results.sent++;
      } catch (error) {
        results.failed++;
        logger.error(`Failed to send data expiring email to tenant ${tenant.id}:`, error);
      }
    }

    logger.info('Data expiring notification results:', results);
  }

  /**
   * Update reminder sent timestamp
   */
  async updateReminderSent(tenantId, reminderType) {
    const columnMap = {
      'seven_day': 'last_reminder_7d',
      'three_day': 'last_reminder_3d',
      'one_day': 'last_reminder_1d'
    };

    const column = columnMap[reminderType];
    if (!column) return;

    await db.query(
      `UPDATE trial_status SET ${column} = NOW() WHERE tenant_id = $1`,
      [tenantId]
    );
  }

  /**
   * Calculate days remaining until date
   */
  calculateDaysRemaining(targetDate) {
    const now = new Date();
    const target = new Date(targetDate);
    const diff = target.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  /**
   * Calculate days since trial start
   */
  calculateDaysUsed(trialStartDate) {
    const now = new Date();
    const start = new Date(trialStartDate);
    const diff = now.getTime() - start.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  /**
   * Calculate days since trial end
   */
  calculateDaysSinceTrialEnd(trialEndDate) {
    const now = new Date();
    const end = new Date(trialEndDate);
    const diff = now.getTime() - end.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  /**
   * Calculate data expiry date (30 days after trial end)
   */
  calculateDataExpiryDate(trialEndDate) {
    const end = new Date(trialEndDate);
    end.setDate(end.getDate() + 30);
    return end;
  }

  /**
   * Get used features for tenant
   */
  getUsedFeatures(tenantId) {
    // This would query what features the tenant has actually used
    // For now, return placeholder
    return 'core analytics and monitoring';
  }

  /**
   * Get record count for tenant
   */
  async getRecordCount(tenantId) {
    const result = await db.query(
      `SELECT COUNT(*) as count FROM fleet_records WHERE tenant_id = $1`,
      [tenantId]
    );
    return result.rows[0]?.count || 0;
  }

  /**
   * Manual trigger for testing
   */
  async processRemindersManual() {
    logger.info('Manually triggering trial reminder processing...');
    await this.processReminders();
  }
}

module.exports = new SendTrialReminders();
