/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.seed = async function(knex) {
	// Clear existing parts and inventory (locations may have FK references)
	await knex('inventory_transactions').del();
	await knex('inventory').del();
	await knex('parts').del();

	// Check if locations exist; if not, insert them
	let locations = await knex('locations').select('*');
	if (locations.length === 0) {
		locations = await knex('locations').insert([
		{
			id: 'aaaa0000-0000-0000-0000-000000000001',
			name: 'Location A',
			address: '123 Main St, New York, NY 10001',
			created_at: new Date(),
			updated_at: new Date()
		},
		{
			id: 'aaaa0000-0000-0000-0000-000000000002',
			name: 'Location B',
			address: '456 Oak Ave, Los Angeles, CA 90001',
			created_at: new Date(),
			updated_at: new Date()
		},
		{
			id: 'aaaa0000-0000-0000-0000-000000000003',
			name: 'Location C',
			address: '789 Elm Dr, Chicago, IL 60601',
			created_at: new Date(),
			updated_at: new Date()
		}
	]).returning('*');
	}

	console.log(`Using ${locations.length} locations`);

	// Insert sample parts (18-wheeler maintenance items)
	const parts = await knex('parts').insert([
		// Filters category
		{
			id: 'bbbb0000-0000-0000-0000-000000000001',
			sku: 'FILTER-OIL-01',
			name: 'Engine Oil Filter',
			category: 'Filters',
			manufacturer: 'Mann+Hummel',
			uom: 'each',
			default_cost: 15.50,
			default_retail_price: 28.99,
			taxable: true,
			is_active: true,
			reorder_point_default: 10,
			reorder_qty_default: 50,
			core_item: false,
			hazmat: false,
			created_at: new Date(),
			updated_at: new Date()
		},
		{
			id: 'bbbb0000-0000-0000-0000-000000000002',
			sku: 'FILTER-AIR-01',
			name: 'Air Filter',
			category: 'Filters',
			manufacturer: 'Donaldson',
			uom: 'each',
			default_cost: 25.00,
			default_retail_price: 45.99,
			taxable: true,
			is_active: true,
			reorder_point_default: 8,
			reorder_qty_default: 30,
			core_item: false,
			hazmat: false,
			created_at: new Date(),
			updated_at: new Date()
		},
		{
			id: 'bbbb0000-0000-0000-0000-000000000003',
			sku: 'FILTER-CABIN-01',
			name: 'Cabin Air Filter',
			category: 'Filters',
			manufacturer: 'Donaldson',
			uom: 'each',
			default_cost: 12.00,
			default_retail_price: 22.99,
			taxable: true,
			is_active: true,
			reorder_point_default: 5,
			reorder_qty_default: 20,
			core_item: false,
			hazmat: false,
			created_at: new Date(),
			updated_at: new Date()
		},
		// Tires category
		{
			id: 'bbbb0000-0000-0000-0000-000000000004',
			sku: 'TIRE-22.5-01',
			name: 'Commercial Truck Tire 22.5"',
			category: 'Tires',
			manufacturer: 'Michelin',
			uom: 'each',
			default_cost: 180.00,
			default_retail_price: 299.99,
			taxable: true,
			is_active: true,
			reorder_point_default: 2,
			reorder_qty_default: 10,
			core_item: false,
			hazmat: false,
			warranty_days: 180,
			created_at: new Date(),
			updated_at: new Date()
		},
		{
			id: 'bbbb0000-0000-0000-0000-000000000005',
			sku: 'TIRE-11R22.5-01',
			name: 'Drive Tire 11R22.5',
			category: 'Tires',
			manufacturer: 'Goodyear',
			uom: 'each',
			default_cost: 165.00,
			default_retail_price: 279.99,
			taxable: true,
			is_active: true,
			reorder_point_default: 3,
			reorder_qty_default: 12,
			core_item: false,
			hazmat: false,
			warranty_days: 180,
			created_at: new Date(),
			updated_at: new Date()
		},
		// Fluids category
		{
			id: 'bbbb0000-0000-0000-0000-000000000006',
			sku: 'FLUID-OIL-15W40-01',
			name: 'Engine Oil 15W40 (Case)',
			category: 'Fluids',
			manufacturer: 'Mobil Delvac',
			uom: 'box',
			default_cost: 145.00,
			default_retail_price: 199.99,
			taxable: true,
			is_active: true,
			reorder_point_default: 5,
			reorder_qty_default: 20,
			hazmat: true,
			created_at: new Date(),
			updated_at: new Date()
		},
		{
			id: 'bbbb0000-0000-0000-0000-000000000007',
			sku: 'FLUID-COOLANT-01',
			name: 'Coolant (Gallon)',
			category: 'Fluids',
			manufacturer: 'Valvoline',
			uom: 'gallon',
			default_cost: 12.00,
			default_retail_price: 19.99,
			taxable: true,
			is_active: true,
			reorder_point_default: 10,
			reorder_qty_default: 50,
			hazmat: true,
			created_at: new Date(),
			updated_at: new Date()
		},
		{
			id: 'bbbb0000-0000-0000-0000-000000000008',
			sku: 'FLUID-BRAKE-01',
			name: 'Brake Fluid (Quart)',
			category: 'Fluids',
			manufacturer: 'Valvoline',
			uom: 'each',
			default_cost: 8.50,
			default_retail_price: 14.99,
			taxable: true,
			is_active: true,
			reorder_point_default: 5,
			reorder_qty_default: 20,
			hazmat: true,
			created_at: new Date(),
			updated_at: new Date()
		},
		// Brakes category
		{
			id: 'bbbb0000-0000-0000-0000-000000000009',
			sku: 'BRAKE-PAD-SET-01',
			name: 'Brake Pad Set (Axle Set)',
			category: 'Brakes',
			manufacturer: 'Meritor',
			uom: 'set',
			default_cost: 280.00,
			default_retail_price: 449.99,
			taxable: true,
			is_active: true,
			reorder_point_default: 3,
			reorder_qty_default: 10,
			core_item: true,
			warranty_days: 365,
			created_at: new Date(),
			updated_at: new Date()
		},
		{
			id: 'bbbb0000-0000-0000-0000-000000000010',
			sku: 'BRAKE-DRUM-01',
			name: 'Brake Drum',
			category: 'Brakes',
			manufacturer: 'Meritor',
			uom: 'each',
			default_cost: 150.00,
			default_retail_price: 249.99,
			taxable: true,
			is_active: true,
			reorder_point_default: 2,
			reorder_qty_default: 8,
			core_item: true,
			warranty_days: 365,
			created_at: new Date(),
			updated_at: new Date()
		},
		// Batteries category
		{
			id: 'bbbb0000-0000-0000-0000-000000000011',
			sku: 'BATT-TRUCK-01',
			name: 'Truck Battery 12V',
			category: 'Batteries',
			manufacturer: 'Optima',
			uom: 'each',
			default_cost: 220.00,
			default_retail_price: 379.99,
			taxable: true,
			is_active: true,
			reorder_point_default: 2,
			reorder_qty_default: 5,
			core_item: true,
			warranty_days: 730,
			created_at: new Date(),
			updated_at: new Date()
		},
		// Lights/Electronics category
		{
			id: 'bbbb0000-0000-0000-0000-000000000012',
			sku: 'LIGHT-LED-WORK-01',
			name: 'LED Work Light',
			category: 'Lights/Electronics',
			manufacturer: 'Philips',
			uom: 'each',
			default_cost: 35.00,
			default_retail_price: 59.99,
			taxable: true,
			is_active: true,
			reorder_point_default: 5,
			reorder_qty_default: 20,
			warranty_days: 180,
			created_at: new Date(),
			updated_at: new Date()
		},
		{
			id: 'bbbb0000-0000-0000-0000-000000000013',
			sku: 'LIGHT-SIGNAL-01',
			name: 'Signal Light Bulb',
			category: 'Lights/Electronics',
			manufacturer: 'Philips',
			uom: 'each',
			default_cost: 4.50,
			default_retail_price: 7.99,
			taxable: true,
			is_active: true,
			reorder_point_default: 20,
			reorder_qty_default: 100,
			created_at: new Date(),
			updated_at: new Date()
		},
		// Belts/Hoses category
		{
			id: 'bbbb0000-0000-0000-0000-000000000014',
			sku: 'BELT-SERPENTINE-01',
			name: 'Serpentine Belt',
			category: 'Belts/Hoses',
			manufacturer: 'Gates',
			uom: 'each',
			default_cost: 25.00,
			default_retail_price: 44.99,
			taxable: true,
			is_active: true,
			reorder_point_default: 5,
			reorder_qty_default: 20,
			created_at: new Date(),
			updated_at: new Date()
		},
		{
			id: 'bbbb0000-0000-0000-0000-000000000015',
			sku: 'HOSE-RADIATOR-01',
			name: 'Radiator Hose',
			category: 'Belts/Hoses',
			manufacturer: 'Gates',
			uom: 'each',
			default_cost: 18.00,
			default_retail_price: 32.99,
			taxable: true,
			is_active: true,
			reorder_point_default: 4,
			reorder_qty_default: 15,
			created_at: new Date(),
			updated_at: new Date()
		}
	]).returning('*');

	console.log(`Seeded ${parts.length} parts`);

	// Insert initial inventory for each location (starting with 0 inventory)
	const inventory = [];
	for (const location of locations) {
		for (const part of parts) {
			inventory.push({
				id: knex.raw('uuid_generate_v4()'),
				location_id: location.id,
				part_id: part.id,
				on_hand_qty: 0,
				reserved_qty: 0,
				min_stock_level: part.reorder_point_default || 5,
				reorder_qty: part.reorder_qty_default || 20,
				created_at: new Date(),
				updated_at: new Date()
			});
		}
	}

	// Batch insert inventory records
	const batchSize = 100;
	for (let i = 0; i < inventory.length; i += batchSize) {
		await knex('inventory').insert(inventory.slice(i, i + batchSize));
	}

	console.log(`Seeded ${inventory.length} inventory records`);
};
