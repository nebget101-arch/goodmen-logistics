/**
 * Fix driver settlement data for John Doe (4e53d668-dbed-4dcd-a2fc-3665822af036)
 * Creates missing compensation profile and updates payee assignment with additional payee
 */

const { knex } = require('../packages/goodmen-shared/internal/db');

const DRIVER_ID = '4e53d668-dbed-4dcd-a2fc-3665822af036';
const ADDITIONAL_PAYEE_ID = '6c0392b3-95fa-47c7-84ec-629396a56489'; // Goodmen Logistics

async function fixDriverData() {
  try {
    console.log('Starting driver data fix...\n');

    // 1. Check current driver data
    const driver = await knex('drivers')
      .where({ id: DRIVER_ID })
      .select('id', 'first_name', 'last_name', 'pay_basis', 'pay_rate', 'pay_percentage', 'driver_type')
      .first();
    
    if (!driver) {
      console.error('Driver not found!');
      return;
    }

    console.log('Driver:', driver);

    // 2. Check for existing compensation profile
    const existingProfile = await knex('driver_compensation_profiles')
      .where({ driver_id: DRIVER_ID, status: 'active' })
      .first();

    if (existingProfile) {
      console.log('\n✓ Compensation profile already exists:', existingProfile.id);
    } else {
      console.log('\n✗ No active compensation profile found. Creating one...');
      
      // Create compensation profile based on driver pay settings
      const payBasisLower = (driver.pay_basis || '').toString().toLowerCase();
      const profileType = (driver.driver_type || '').toString().toLowerCase() === 'owner_operator' 
        ? 'owner_operator' 
        : 'company_driver';
      
      let payModel = 'percentage';
      let centsPerMile = null;
      let percentageRate = driver.pay_percentage || 44; // Default to 44%
      let flatWeeklyAmount = null;
      let flatPerLoadAmount = null;

      if (payBasisLower === 'per_mile') {
        payModel = 'per_mile';
        centsPerMile = driver.pay_rate;
        percentageRate = null;
      } else if (payBasisLower === 'flatpay' || payBasisLower === 'flat_weekly') {
        payModel = 'flat_weekly';
        flatWeeklyAmount = driver.pay_rate;
        percentageRate = null;
      } else if (payBasisLower === 'flat_per_load') {
        payModel = 'flat_per_load';
        flatPerLoadAmount = driver.pay_rate;
        percentageRate = null;
      }

      const [newProfile] = await knex('driver_compensation_profiles')
        .insert({
          driver_id: DRIVER_ID,
          profile_type: profileType,
          pay_model: payModel,
          percentage_rate: percentageRate,
          cents_per_mile: centsPerMile,
          flat_weekly_amount: flatWeeklyAmount,
          flat_per_load_amount: flatPerLoadAmount,
          expense_sharing_enabled: false,
          effective_start_date: '2026-03-01',
          effective_end_date: null,
          status: 'active',
          notes: 'Created by fix script'
        })
        .returning('*');

      console.log('✓ Created compensation profile:', {
        id: newProfile.id,
        pay_model: newProfile.pay_model,
        percentage_rate: newProfile.percentage_rate
      });
    }

    // 3. Check payee assignment
    const payeeAssignment = await knex('driver_payee_assignments')
      .where({ driver_id: DRIVER_ID })
      .orderBy('effective_start_date', 'desc')
      .first();

    if (!payeeAssignment) {
      console.log('\n✗ No payee assignment found. Creating one...');
      
      // Get or create primary payee for driver
      let primaryPayee = await knex('payees')
        .where({ type: 'driver', name: `${driver.first_name} ${driver.last_name}` })
        .first();

      if (!primaryPayee) {
        [primaryPayee] = await knex('payees')
          .insert({
            type: 'driver',
            name: `${driver.first_name} ${driver.last_name}`,
            is_active: true
          })
          .returning('*');
        console.log('  Created primary payee:', primaryPayee.id);
      }

      await knex('driver_payee_assignments')
        .insert({
          driver_id: DRIVER_ID,
          primary_payee_id: primaryPayee.id,
          additional_payee_id: ADDITIONAL_PAYEE_ID,
          rule_type: 'company_truck',
          effective_start_date: '2026-03-01',
          effective_end_date: null
        });

      console.log('✓ Created payee assignment with additional payee:', ADDITIONAL_PAYEE_ID);
    } else if (!payeeAssignment.additional_payee_id) {
      console.log('\n✗ Payee assignment exists but missing additional_payee_id. Updating...');
      
      await knex('driver_payee_assignments')
        .where({ id: payeeAssignment.id })
        .update({ additional_payee_id: ADDITIONAL_PAYEE_ID });

      console.log('✓ Updated payee assignment with additional payee:', ADDITIONAL_PAYEE_ID);
    } else {
      console.log('\n✓ Payee assignment already has additional_payee_id:', payeeAssignment.additional_payee_id);
    }

    // 4. Update expense responsibility profiles to link to compensation profile
    const profileToLink = existingProfile || await knex('driver_compensation_profiles')
      .where({ driver_id: DRIVER_ID, status: 'active' })
      .first();

    if (profileToLink) {
      const updatedCount = await knex('expense_responsibility_profiles')
        .where({ driver_id: DRIVER_ID, compensation_profile_id: null })
        .update({ compensation_profile_id: profileToLink.id });

      if (updatedCount > 0) {
        console.log(`\n✓ Updated ${updatedCount} expense responsibility profile(s) to link to compensation profile`);
      }
    }

    console.log('\n✅ Driver data fix completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Create a new settlement for this driver');
    console.log('2. It should now have compensation_profile_id and additional_payee_id populated');
    console.log('3. Additional payee calculations should show 44% of gross');

  } catch (error) {
    console.error('\n❌ Error fixing driver data:', error);
    throw error;
  } finally {
    await knex.destroy();
  }
}

fixDriverData();
