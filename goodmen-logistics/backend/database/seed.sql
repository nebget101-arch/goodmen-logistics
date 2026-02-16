-- Goodmen Logistics Sample Data
-- Insert Locations
INSERT INTO locations (id, name, address, settings, created_at, updated_at)
VALUES
    (uuid_generate_v4(), 'Garland', '123 Garland Ave, Garland, TX 75040', '{}', NOW(), NOW()),
    (uuid_generate_v4(), 'Rockwall', '456 Rockwall Rd, Rockwall, TX 75087', '{}', NOW(), NOW()),
    (uuid_generate_v4(), 'Hutchins', '789 Hutchins Blvd, Hutchins, TX 75141', '{}', NOW(), NOW());
-- Insert Drivers
INSERT INTO drivers (id, first_name, last_name, email, phone, cdl_number, cdl_state, cdl_class, endorsements, cdl_expiry, medical_cert_expiry, hire_date, status, dqf_completeness, address, date_of_birth, last_mvr_check, clearinghouse_status) VALUES
(uuid_generate_v4(), 'John', 'Smith', 'john.smith@goodmenlogistics.com', '555-0101', 'CDL123456', 'CA', 'A', ARRAY['H', 'N', 'T'], '2026-12-15', '2025-08-20', '2022-03-15', 'active', 95, '123 Main St, Los Angeles, CA 90001', '1985-05-12', '2025-01-15', 'eligible'),
(uuid_generate_v4(), 'Sarah', 'Johnson', 'sarah.johnson@goodmenlogistics.com', '555-0102', 'CDL789012', 'TX', 'A', ARRAY['H', 'N'], '2027-03-22', '2025-02-10', '2021-07-20', 'active', 88, '456 Oak Ave, Houston, TX 77001', '1990-09-25', '2025-01-10', 'eligible'),
(uuid_generate_v4(), 'Michael', 'Davis', 'michael.davis@goodmenlogistics.com', '555-0103', 'CDL345678', 'FL', 'B', ARRAY['P', 'S'], '2025-06-30', '2024-12-15', '2023-01-10', 'active', 72, '789 Beach Blvd, Miami, FL 33101', '1988-11-03', '2024-12-01', 'query-pending'),
(uuid_generate_v4(), 'Emily', 'Wilson', 'emily.wilson@goodmenlogistics.com', '555-0104', 'CDL901234', 'NY', 'A', ARRAY['H', 'N', 'T', 'X'], '2026-08-18', '2025-11-05', '2020-05-22', 'active', 92, '321 Park Ave, New York, NY 10001', '1987-03-17', '2025-01-12', 'eligible'),
(uuid_generate_v4(), 'Robert', 'Brown', 'robert.brown@goodmenlogistics.com', '555-0105', 'CDL567890', 'IL', 'A', ARRAY['H', 'N'], '2026-04-25', '2025-09-30', '2022-11-08', 'active', 85, '654 Lake Shore Dr, Chicago, IL 60601', '1992-07-22', '2025-01-08', 'eligible');

-- Insert Vehicles
INSERT INTO vehicles (id, unit_number, vin, make, model, year, license_plate, state, status, mileage, inspection_expiry, next_pm_due, next_pm_mileage, eld_device_id, insurance_expiry, registration_expiry, oos_reason) VALUES
(uuid_generate_v4(), 'TRK-001', '1HGBH41JXMN109186', 'Freightliner', 'Cascadia', 2022, 'CA-TRK001', 'CA', 'in-service', 125000, '2025-01-15', '2025-03-15', 135000, 'ELD-TRK001', '2025-12-31', '2025-11-30', NULL),
(uuid_generate_v4(), 'TRK-002', '2FMDK3KC5DBA12345', 'Kenworth', 'T680', 2021, 'TX-TRK002', 'TX', 'in-service', 98000, '2025-01-20', '2025-02-20', 108000, 'ELD-TRK002', '2025-12-31', '2025-10-15', NULL),
(uuid_generate_v4(), 'TRK-003', '3AKJHHDR1JSKG1234', 'Peterbilt', '579', 2020, 'FL-TRK003', 'FL', 'out-of-service', 245000, '2025-01-25', '2025-01-28', 250000, 'ELD-TRK003', '2025-12-31', '2025-09-20', 'Brake system repair required'),
(uuid_generate_v4(), 'TRK-004', '4AKJHHDR2JSKG5678', 'Volvo', 'VNL 760', 2023, 'NY-TRK004', 'NY', 'in-service', 45000, '2025-01-10', '2025-04-10', 55000, 'ELD-TRK004', '2025-12-31', '2025-12-15', NULL),
(uuid_generate_v4(), 'TRK-005', '5AKJHHDR3JSKG9012', 'Mack', 'Anthem', 2022, 'IL-TRK005', 'IL', 'in-service', 87000, '2025-01-18', '2025-03-18', 97000, 'ELD-TRK005', '2025-12-31', '2025-11-20', NULL);

-- Note: We'll insert HOS records, maintenance, drug tests, and loads using a separate script
-- This is because they require driver_id and vehicle_id which are auto-generated

-- Insert HOS Records (using subqueries to get driver IDs)
INSERT INTO hos_records (id, driver_id, record_date, on_duty_hours, driving_hours, off_duty_hours, sleeper_berth_hours, violations, status, eld_device_id)
SELECT 
    uuid_generate_v4(),
    d.id,
    '2025-02-04'::date,
    10.5,
    8.5,
    13.5,
    0,
    ARRAY[]::text[],
    'compliant',
    'ELD-TRK001'
FROM drivers d WHERE d.email = 'john.smith@goodmenlogistics.com';

INSERT INTO hos_records (id, driver_id, record_date, on_duty_hours, driving_hours, off_duty_hours, sleeper_berth_hours, violations, status, eld_device_id)
SELECT 
    uuid_generate_v4(),
    d.id,
    '2025-02-04'::date,
    11.5,
    10.5,
    12.5,
    0,
    ARRAY['Approaching 11-hour drive limit'],
    'warning',
    'ELD-TRK002'
FROM drivers d WHERE d.email = 'sarah.johnson@goodmenlogistics.com';

INSERT INTO hos_records (id, driver_id, record_date, on_duty_hours, driving_hours, off_duty_hours, sleeper_berth_hours, violations, status, eld_device_id)
SELECT 
    uuid_generate_v4(),
    d.id,
    '2025-02-04'::date,
    9.0,
    7.5,
    15.0,
    0,
    ARRAY[]::text[],
    'compliant',
    'ELD-TRK003'
FROM drivers d WHERE d.email = 'michael.davis@goodmenlogistics.com';

-- Insert HOS Logs for John Smith
INSERT INTO hos_logs (hos_record_id, log_time, status, location)
SELECT 
    hr.id,
    '06:00'::time,
    'on-duty-not-driving',
    'Los Angeles, CA'
FROM hos_records hr
JOIN drivers d ON hr.driver_id = d.id
WHERE d.email = 'john.smith@goodmenlogistics.com' AND hr.record_date = '2025-02-04';

INSERT INTO hos_logs (hos_record_id, log_time, status, location)
SELECT 
    hr.id,
    '07:00'::time,
    'driving',
    'Los Angeles, CA'
FROM hos_records hr
JOIN drivers d ON hr.driver_id = d.id
WHERE d.email = 'john.smith@goodmenlogistics.com' AND hr.record_date = '2025-02-04';

INSERT INTO hos_logs (hos_record_id, log_time, status, location)
SELECT 
    hr.id,
    '11:00'::time,
    'on-duty-not-driving',
    'Bakersfield, CA'
FROM hos_records hr
JOIN drivers d ON hr.driver_id = d.id
WHERE d.email = 'john.smith@goodmenlogistics.com' AND hr.record_date = '2025-02-04';

INSERT INTO hos_logs (hos_record_id, log_time, status, location)
SELECT 
    hr.id,
    '11:30'::time,
    'off-duty',
    'Bakersfield, CA'
FROM hos_records hr
JOIN drivers d ON hr.driver_id = d.id
WHERE d.email = 'john.smith@goodmenlogistics.com' AND hr.record_date = '2025-02-04';

INSERT INTO hos_logs (hos_record_id, log_time, status, location)
SELECT 
    hr.id,
    '12:00'::time,
    'driving',
    'Bakersfield, CA'
FROM hos_records hr
JOIN drivers d ON hr.driver_id = d.id
WHERE d.email = 'john.smith@goodmenlogistics.com' AND hr.record_date = '2025-02-04';

INSERT INTO hos_logs (hos_record_id, log_time, status, location)
SELECT 
    hr.id,
    '16:30'::time,
    'off-duty',
    'Sacramento, CA'
FROM hos_records hr
JOIN drivers d ON hr.driver_id = d.id
WHERE d.email = 'john.smith@goodmenlogistics.com' AND hr.record_date = '2025-02-04';

-- Insert Maintenance Records
INSERT INTO maintenance_records (vehicle_id, type, description, date_performed, mileage, mechanic_name, cost, status, parts_used, next_service_due)
SELECT 
    v.id,
    'Preventive Maintenance',
    'Oil change, filter replacement, safety inspection',
    '2025-01-15'::date,
    125000,
    'Tom Wilson',
    450.00,
    'completed',
    ARRAY['Oil Filter', 'Air Filter', 'Engine Oil (15W-40)'],
    '2025-03-15'::date
FROM vehicles v WHERE v.unit_number = 'TRK-001';

INSERT INTO maintenance_records (vehicle_id, type, description, date_performed, mileage, mechanic_name, cost, status, parts_used)
SELECT 
    v.id,
    'Repair',
    'Brake pad replacement - front axle',
    '2025-01-20'::date,
    98000,
    'Bob Martinez',
    680.00,
    'completed',
    ARRAY['Brake Pads (Front Set)', 'Brake Rotors']
FROM vehicles v WHERE v.unit_number = 'TRK-002';

INSERT INTO maintenance_records (vehicle_id, type, description, mileage, mechanic_name, cost, status, parts_used, priority)
SELECT 
    v.id,
    'Repair',
    'Brake system overhaul - safety critical',
    245000,
    'Assigned: Bob Martinez',
    0,
    'pending',
    ARRAY[]::text[],
    'critical'
FROM vehicles v WHERE v.unit_number = 'TRK-003';

-- Insert Drug & Alcohol Tests
INSERT INTO drug_alcohol_tests (driver_id, test_type, test_date, result, testing_facility, collector_name, specimen, substances_tested, certified_by)
SELECT 
    d.id,
    'Random',
    '2024-11-15'::date,
    'Negative',
    'ABC Testing Center',
    'Jane Doe',
    'Urine',
    ARRAY['Marijuana', 'Cocaine', 'Amphetamines', 'Opiates', 'PCP'],
    'MRO - Dr. Smith'
FROM drivers d WHERE d.email = 'john.smith@goodmenlogistics.com';

INSERT INTO drug_alcohol_tests (driver_id, test_type, test_date, result, testing_facility, collector_name, specimen, substances_tested, certified_by)
SELECT 
    d.id,
    'Pre-Employment',
    '2021-07-10'::date,
    'Negative',
    'XYZ Drug Testing',
    'John Anderson',
    'Urine',
    ARRAY['Marijuana', 'Cocaine', 'Amphetamines', 'Opiates', 'PCP'],
    'MRO - Dr. Johnson'
FROM drivers d WHERE d.email = 'sarah.johnson@goodmenlogistics.com';

INSERT INTO drug_alcohol_tests (driver_id, test_type, test_date, result, testing_facility, collector_name, specimen, substances_tested, certified_by)
SELECT 
    d.id,
    'Random',
    '2025-01-20'::date,
    'Negative',
    'ABC Testing Center',
    'Jane Doe',
    'Urine',
    ARRAY['Marijuana', 'Cocaine', 'Amphetamines', 'Opiates', 'PCP'],
    'MRO - Dr. Smith'
FROM drivers d WHERE d.email = 'john.smith@goodmenlogistics.com';

-- Insert Loads
INSERT INTO loads (load_number, driver_id, vehicle_id, status, pickup_location, delivery_location, pickup_date, delivery_date, commodity, weight, distance, rate, shipper, consignee, bol_number)
SELECT 
    'LD-2025-001',
    d.id,
    v.id,
    'in-transit',
    'Los Angeles, CA',
    'Sacramento, CA',
    '2025-02-04 07:00:00'::timestamp,
    '2025-02-04 17:00:00'::timestamp,
    'Electronics',
    42000,
    385,
    1850.00,
    'Tech Distribution Inc.',
    'Northern Electronics',
    'BOL-2025-001'
FROM drivers d, vehicles v 
WHERE d.email = 'john.smith@goodmenlogistics.com' AND v.unit_number = 'TRK-001';

INSERT INTO loads (load_number, driver_id, vehicle_id, status, pickup_location, delivery_location, pickup_date, delivery_date, commodity, weight, distance, rate, shipper, consignee, bol_number)
SELECT 
    'LD-2025-002',
    d.id,
    v.id,
    'in-transit',
    'Houston, TX',
    'El Paso, TX',
    '2025-02-04 06:00:00'::timestamp,
    '2025-02-05 14:00:00'::timestamp,
    'Food Products',
    38000,
    746,
    2450.00,
    'Texas Food Distributors',
    'West Texas Grocers',
    'BOL-2025-002'
FROM drivers d, vehicles v 
WHERE d.email = 'sarah.johnson@goodmenlogistics.com' AND v.unit_number = 'TRK-002';

INSERT INTO loads (load_number, status, pickup_location, delivery_location, pickup_date, delivery_date, commodity, weight, distance, rate, shipper, consignee, bol_number)
VALUES 
('LD-2025-003', 'pending', 'Atlanta, GA', 'Miami, FL', '2025-02-05 08:00:00'::timestamp, '2025-02-06 16:00:00'::timestamp, 'Automotive Parts', 35000, 662, 2100.00, 'AutoParts Warehouse', 'Florida Auto Supply', 'BOL-2025-003');

-- Insert some audit logs
INSERT INTO audit_logs (entity_type, entity_id, action, changes, performed_by, ip_address)
SELECT 
    'driver',
    d.id,
    'created',
    '{"status": "active"}'::jsonb,
    'system',
    '127.0.0.1'
FROM drivers d LIMIT 1;

-- Insert Vehicle Documents
INSERT INTO vehicle_documents (vehicle_id, document_type, file_name, file_path, file_size, mime_type, expiry_date, uploaded_by, notes)
SELECT 
    v.id,
    'inspection',
    'annual_inspection_2025.pdf',
    '/uploads/vehicles/TRK-001/inspection_2025.pdf',
    245632,
    'application/pdf',
    '2026-01-15',
    'admin',
    'Annual DOT inspection completed'
FROM vehicles v WHERE v.unit_number = 'TRK-001';

INSERT INTO vehicle_documents (vehicle_id, document_type, file_name, file_path, file_size, mime_type, expiry_date, uploaded_by, notes)
SELECT 
    v.id,
    'registration',
    'vehicle_registration.pdf',
    '/uploads/vehicles/TRK-001/registration.pdf',
    128456,
    'application/pdf',
    '2025-11-30',
    'admin',
    'California vehicle registration'
FROM vehicles v WHERE v.unit_number = 'TRK-001';

INSERT INTO vehicle_documents (vehicle_id, document_type, file_name, file_path, file_size, mime_type, expiry_date, uploaded_by, notes)
SELECT 
    v.id,
    'insurance',
    'insurance_certificate.pdf',
    '/uploads/vehicles/TRK-002/insurance.pdf',
    198234,
    'application/pdf',
    '2025-12-31',
    'admin',
    'Commercial vehicle insurance policy'
FROM vehicles v WHERE v.unit_number = 'TRK-002';

INSERT INTO vehicle_documents (vehicle_id, document_type, file_name, file_path, file_size, mime_type, expiry_date, uploaded_by, notes)
SELECT 
    v.id,
    'maintenance',
    'brake_repair_receipt.pdf',
    '/uploads/vehicles/TRK-003/maintenance_brake_2025.pdf',
    87456,
    'application/pdf',
    NULL,
    'Brake system repair - OOS reason'
FROM vehicles v WHERE v.unit_number = 'TRK-003';
