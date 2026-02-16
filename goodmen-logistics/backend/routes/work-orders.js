const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const dtLogger = require('../utils/dynatrace-logger');
const auth = require('./auth-middleware');

async function getCustomerPricing(customerId) {
  if (!customerId) return null;
  const result = await query(
    `SELECT c.id, c.status, c.customer_type, c.is_deleted,
            pr.default_labor_rate, pr.parts_discount_percent, pr.labor_discount_percent
     FROM customers c
     LEFT JOIN customer_pricing_rules pr ON pr.customer_id = c.id
     WHERE c.id = $1 AND c.is_deleted = false`,
    [customerId]
  );
  return result.rows[0] || null;
}

// Protect all work order routes: admin, fleet
router.use(auth(['admin', 'fleet']));

// POST create new work order (stored in maintenance_records)
router.post('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const {
      vehicleId,
      customerId,
      title,
      type,
      status,
      requestDate,
      completionDate,
      currentOdometer,
      assignedTo,
      priority,
      parts,
      labor
    } = req.body || {};

    const normalize = (value) => {
      if (value === undefined || value === null) return null;
      if (typeof value === 'string' && value.trim() === '') return null;
      return value;
    };

    const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

    let normalizedVehicleId = normalize(vehicleId);
    if (normalizedVehicleId && typeof normalizedVehicleId === 'string') {
      normalizedVehicleId = normalizedVehicleId.trim();
    }

    if (!normalizedVehicleId) {
      return res.status(400).json({ message: 'vehicleId is required' });
    }

    const vehicleIdString = String(normalizedVehicleId);
    if (!isUuid(vehicleIdString)) {
      const lookupVin = normalize(req.body?.vin);
      const lookupUnit = normalize(req.body?.unitNumber || req.body?.unit_number || normalizedVehicleId);

      const vehicleLookup = await query(
        `SELECT id FROM vehicles WHERE ($1::text IS NOT NULL AND vin = $1) OR ($2::text IS NOT NULL AND unit_number = $2) LIMIT 1`,
        [lookupVin, lookupUnit]
      );

      if (vehicleLookup.rows.length === 0) {
        const customerVehicleLookup = await query(
          `SELECT * FROM customer_vehicles WHERE ($1::text IS NOT NULL AND vin = $1) OR ($2::text IS NOT NULL AND unit_number = $2) LIMIT 1`,
          [lookupVin, lookupUnit]
        );

        if (customerVehicleLookup.rows.length === 0) {
          return res.status(400).json({ message: 'vehicleId must be a valid UUID or match an existing vehicle vin/unit_number' });
        }

        // Create a matching record in vehicles to satisfy FK constraint
        const customerVehicle = customerVehicleLookup.rows[0];
        const finalVin = normalize(lookupVin || customerVehicle.vin);
        const finalUnitNumber = normalize(lookupUnit || customerVehicle.unit_number || (finalVin ? finalVin.slice(-4) : null));
        const finalMake = normalize(req.body?.make || customerVehicle.make);
        const finalModel = normalize(req.body?.model || customerVehicle.model);
        const finalYear = normalize(req.body?.year || customerVehicle.year);
        const finalState = normalize(req.body?.state || customerVehicle.state);
        const finalMileage = normalize(req.body?.currentOdometer || customerVehicle.mileage);

        const createdVehicle = await query(
          `INSERT INTO vehicles (
            unit_number, vin, make, model, year, license_plate, state, mileage,
            status
          )
           VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, 'in-service')
           RETURNING id`,
          [
            finalUnitNumber,
            finalVin,
            finalMake,
            finalModel,
            finalYear,
            finalState,
            finalMileage ? parseInt(finalMileage, 10) : null
          ]
        );

        normalizedVehicleId = createdVehicle.rows[0].id;
      } else {
        normalizedVehicleId = vehicleLookup.rows[0].id;
      }
    }

    const normalizedStatus = status ? status.toString().trim().toLowerCase().replace(/\s+/g, '_') : 'pending';
    const description = normalize(title ? title.toString().trim() : null);
    const datePerformed = normalize(completionDate || requestDate || null);
    const mileage = normalize(currentOdometer) ? parseInt(currentOdometer, 10) : null;
    const mechanicName = normalize(assignedTo ? assignedTo.toString().trim() : null);
    const priorityValue = normalize(priority ? priority.toString().trim() : null);

    const partsUsed = Array.isArray(parts)
      ? parts
          .map(p => (p && p.name ? p.name.toString().trim() : null))
          .filter(Boolean)
      : null;

    let partsCost = Array.isArray(parts)
      ? parts.reduce((sum, p) => sum + (Number(p?.totalCost) || 0), 0)
      : 0;
    let laborCost = Array.isArray(labor)
      ? labor.reduce((sum, l) => sum + (Number(l?.totalCost) || 0), 0)
      : 0;

    const pricing = await getCustomerPricing(normalize(customerId));
    if (pricing && pricing.status === 'INACTIVE') {
      return res.status(400).json({ message: 'Inactive customers cannot be used for new work orders' });
    }

    if (pricing) {
      const defaultLaborRate = pricing.default_labor_rate !== null && pricing.default_labor_rate !== undefined
        ? Number(pricing.default_labor_rate)
        : (pricing.customer_type === 'WARRANTY' ? 0 : null);

      if (defaultLaborRate !== null && Array.isArray(labor) && labor.some(l => l?.hours !== undefined && l?.hours !== null)) {
        laborCost = labor.reduce((sum, l) => {
          const hours = Number(l?.hours) || 0;
          const rate = l?.rate !== undefined && l?.rate !== null ? Number(l.rate) : defaultLaborRate;
          return sum + (hours * (Number.isNaN(rate) ? 0 : rate));
        }, 0);
      }

      if (pricing.parts_discount_percent !== null && pricing.parts_discount_percent !== undefined) {
        partsCost = partsCost * (1 - Number(pricing.parts_discount_percent) / 100);
      }
      if (pricing.labor_discount_percent !== null && pricing.labor_discount_percent !== undefined) {
        laborCost = laborCost * (1 - Number(pricing.labor_discount_percent) / 100);
      }
    }

    const totalCost = partsCost + laborCost;

    const result = await query(
      `INSERT INTO maintenance_records (
        vehicle_id, type, description, date_performed, mileage,
        mechanic_name, cost, status, parts_used, priority, customer_id
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        normalizedVehicleId,
        type || 'Repair',
        description,
        datePerformed,
        mileage,
        mechanicName,
        totalCost || 0,
        normalizedStatus,
        partsUsed,
        priorityValue,
        normalize(customerId)
      ]
    );

    const duration = Date.now() - startTime;
    dtLogger.trackDatabase('INSERT', 'maintenance_records', duration, true, { workOrderId: result.rows[0].id });
    dtLogger.trackEvent('work_order.created', { workOrderId: result.rows[0].id, vehicleId });
    dtLogger.trackRequest('POST', '/api/work-orders', 201, duration);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to create work order', error, { body: req.body });
    dtLogger.trackRequest('POST', '/api/work-orders', 500, duration);
    console.error('Error creating work order:', error);
    res.status(500).json({ message: 'Failed to create work order', error: error.message });
  }
});

// GET work order by ID
router.get('/:id', async (req, res) => {
  try {
    const result = await query(
      `SELECT
        mr.id,
        mr.vehicle_id as "vehicleId",
        mr.type,
        mr.description,
        mr.date_performed as "datePerformed",
        mr.mileage,
        mr.mechanic_name as "mechanicName",
        mr.cost,
        mr.status,
        mr.priority,
        mr.customer_id as "customerId",
        mr.created_at as "createdAt",
        mr.updated_at as "updatedAt",
        v.unit_number as "vehicleUnit",
        v.vin
      FROM maintenance_records mr
      JOIN vehicles v ON mr.vehicle_id = v.id
      WHERE mr.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Work order not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching work order:', error);
    res.status(500).json({ message: 'Failed to fetch work order' });
  }
});

// PUT update work order
router.put('/:id', async (req, res) => {
  try {
    const normalize = (value) => {
      if (value === undefined || value === null) return null;
      if (typeof value === 'string' && value.trim() === '') return null;
      return value;
    };

    const {
      vehicleId,
      customerId,
      title,
      type,
      status,
      requestDate,
      completionDate,
      currentOdometer,
      assignedTo,
      priority,
      parts,
      labor
    } = req.body || {};

    const normalizedStatus = status ? status.toString().trim().toLowerCase().replace(/\s+/g, '_') : 'pending';
    const description = normalize(title ? title.toString().trim() : null);
    const datePerformed = normalize(completionDate || requestDate || null);
    const mileage = normalize(currentOdometer) ? parseInt(currentOdometer, 10) : null;
    const mechanicName = normalize(assignedTo ? assignedTo.toString().trim() : null);
    const priorityValue = normalize(priority ? priority.toString().trim() : null);

    const partsUsed = Array.isArray(parts)
      ? parts
          .map(p => (p && p.name ? p.name.toString().trim() : null))
          .filter(Boolean)
      : null;

    let partsCost = Array.isArray(parts)
      ? parts.reduce((sum, p) => sum + (Number(p?.totalCost) || 0), 0)
      : 0;
    let laborCost = Array.isArray(labor)
      ? labor.reduce((sum, l) => sum + (Number(l?.totalCost) || 0), 0)
      : 0;

    const pricing = await getCustomerPricing(normalize(customerId));
    if (pricing && pricing.status === 'INACTIVE') {
      return res.status(400).json({ message: 'Inactive customers cannot be used for work orders' });
    }

    if (pricing) {
      const defaultLaborRate = pricing.default_labor_rate !== null && pricing.default_labor_rate !== undefined
        ? Number(pricing.default_labor_rate)
        : (pricing.customer_type === 'WARRANTY' ? 0 : null);

      if (defaultLaborRate !== null && Array.isArray(labor) && labor.some(l => l?.hours !== undefined && l?.hours !== null)) {
        laborCost = labor.reduce((sum, l) => {
          const hours = Number(l?.hours) || 0;
          const rate = l?.rate !== undefined && l?.rate !== null ? Number(l.rate) : defaultLaborRate;
          return sum + (hours * (Number.isNaN(rate) ? 0 : rate));
        }, 0);
      }

      if (pricing.parts_discount_percent !== null && pricing.parts_discount_percent !== undefined) {
        partsCost = partsCost * (1 - Number(pricing.parts_discount_percent) / 100);
      }
      if (pricing.labor_discount_percent !== null && pricing.labor_discount_percent !== undefined) {
        laborCost = laborCost * (1 - Number(pricing.labor_discount_percent) / 100);
      }
    }

    const totalCost = partsCost + laborCost;

    const result = await query(
      `UPDATE maintenance_records SET
        vehicle_id = $1,
        type = $2,
        description = $3,
        date_performed = $4,
        mileage = $5,
        mechanic_name = $6,
        cost = $7,
        status = $8,
        parts_used = $9,
        priority = $10,
        customer_id = $11,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $12
       RETURNING *`,
      [
        normalize(vehicleId),
        type || 'Repair',
        description,
        datePerformed,
        mileage,
        mechanicName,
        totalCost || 0,
        normalizedStatus,
        partsUsed,
        priorityValue,
        normalize(customerId),
        req.params.id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Work order not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating work order:', error);
    res.status(500).json({ message: 'Failed to update work order' });
  }
});

module.exports = router;
