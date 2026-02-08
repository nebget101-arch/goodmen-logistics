-- Goodmen Logistics Database Schema
-- Drop existing tables if they exist
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS loads CASCADE;
DROP TABLE IF EXISTS drug_alcohol_tests CASCADE;
DROP TABLE IF EXISTS maintenance_records CASCADE;
DROP TABLE IF EXISTS hos_logs CASCADE;
DROP TABLE IF EXISTS hos_records CASCADE;
DROP TABLE IF EXISTS vehicles CASCADE;
DROP TABLE IF EXISTS drivers CASCADE;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drivers Table
CREATE TABLE drivers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    cdl_number VARCHAR(50) UNIQUE NOT NULL,
    cdl_state VARCHAR(2) NOT NULL,
    cdl_class VARCHAR(10) NOT NULL,
    endorsements TEXT[], -- Array of endorsements
    cdl_expiry DATE,
    medical_cert_expiry DATE,
    hire_date DATE,
    status VARCHAR(20) DEFAULT 'active',
    dqf_completeness INTEGER DEFAULT 0,
    address TEXT,
    date_of_birth DATE,
    last_mvr_check DATE,
    clearinghouse_status VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Vehicles Table
CREATE TABLE vehicles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    unit_number VARCHAR(50) UNIQUE NOT NULL,
    vin VARCHAR(17) UNIQUE NOT NULL,
    make VARCHAR(100) NOT NULL,
    model VARCHAR(100) NOT NULL,
    year INTEGER NOT NULL,
    license_plate VARCHAR(20),
    state VARCHAR(2),
    status VARCHAR(20) DEFAULT 'in-service',
    mileage INTEGER DEFAULT 0,
    last_inspection_date DATE,
    next_pm_due DATE,
    next_pm_mileage INTEGER,
    eld_device_id VARCHAR(50),
    insurance_expiry DATE,
    registration_expiry DATE,
    oos_reason TEXT, -- Out of service reason
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- HOS Records Table
CREATE TABLE hos_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    record_date DATE NOT NULL,
    on_duty_hours DECIMAL(4,2) DEFAULT 0,
    driving_hours DECIMAL(4,2) DEFAULT 0,
    off_duty_hours DECIMAL(4,2) DEFAULT 0,
    sleeper_berth_hours DECIMAL(4,2) DEFAULT 0,
    violations TEXT[],
    status VARCHAR(20) DEFAULT 'compliant',
    eld_device_id VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(driver_id, record_date)
);

-- HOS Logs Table (detailed log entries for each HOS record)
CREATE TABLE hos_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hos_record_id UUID NOT NULL REFERENCES hos_records(id) ON DELETE CASCADE,
    log_time TIME NOT NULL,
    status VARCHAR(50) NOT NULL,
    location TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Maintenance Records Table
CREATE TABLE maintenance_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    description TEXT,
    date_performed DATE,
    mileage INTEGER,
    mechanic_name VARCHAR(100),
    cost DECIMAL(10,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending',
    parts_used TEXT[],
    next_service_due DATE,
    priority VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Drug & Alcohol Tests Table
CREATE TABLE drug_alcohol_tests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    test_type VARCHAR(50) NOT NULL,
    test_date DATE NOT NULL,
    result VARCHAR(20) NOT NULL,
    testing_facility VARCHAR(255),
    collector_name VARCHAR(100),
    specimen VARCHAR(50),
    substances_tested TEXT[],
    certified_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Loads Table
CREATE TABLE loads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    load_number VARCHAR(50) UNIQUE NOT NULL,
    driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'pending',
    pickup_location TEXT NOT NULL,
    delivery_location TEXT NOT NULL,
    pickup_date TIMESTAMP NOT NULL,
    delivery_date TIMESTAMP NOT NULL,
    commodity VARCHAR(255),
    weight INTEGER,
    distance INTEGER,
    rate DECIMAL(10,2),
    shipper VARCHAR(255),
    consignee VARCHAR(255),
    bol_number VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Audit Logs Table
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    action VARCHAR(50) NOT NULL,
    changes JSONB,
    performed_by VARCHAR(100),
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX idx_drivers_status ON drivers(status);
CREATE INDEX idx_drivers_email ON drivers(email);
CREATE INDEX idx_drivers_cdl_expiry ON drivers(cdl_expiry);
CREATE INDEX idx_drivers_medical_cert_expiry ON drivers(medical_cert_expiry);

CREATE INDEX idx_vehicles_status ON vehicles(status);
CREATE INDEX idx_vehicles_unit_number ON vehicles(unit_number);
CREATE INDEX idx_vehicles_next_pm_due ON vehicles(next_pm_due);

CREATE INDEX idx_hos_records_driver_id ON hos_records(driver_id);
CREATE INDEX idx_hos_records_date ON hos_records(record_date);
CREATE INDEX idx_hos_records_status ON hos_records(status);

CREATE INDEX idx_hos_logs_hos_record_id ON hos_logs(hos_record_id);

CREATE INDEX idx_maintenance_vehicle_id ON maintenance_records(vehicle_id);
CREATE INDEX idx_maintenance_status ON maintenance_records(status);
CREATE INDEX idx_maintenance_date ON maintenance_records(date_performed);

CREATE INDEX idx_drug_tests_driver_id ON drug_alcohol_tests(driver_id);
CREATE INDEX idx_drug_tests_date ON drug_alcohol_tests(test_date);

CREATE INDEX idx_loads_driver_id ON loads(driver_id);
CREATE INDEX idx_loads_vehicle_id ON loads(vehicle_id);
CREATE INDEX idx_loads_status ON loads(status);
CREATE INDEX idx_loads_pickup_date ON loads(pickup_date);

CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

-- DQF Documents Table
CREATE TABLE dqf_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    document_type VARCHAR(100) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size INTEGER,
    mime_type VARCHAR(100),
    uploaded_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_dqf_documents_driver ON dqf_documents(driver_id);
CREATE INDEX idx_dqf_documents_type ON dqf_documents(document_type);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers to relevant tables
CREATE TRIGGER update_drivers_updated_at BEFORE UPDATE ON drivers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vehicles_updated_at BEFORE UPDATE ON vehicles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_hos_records_updated_at BEFORE UPDATE ON hos_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_maintenance_updated_at BEFORE UPDATE ON maintenance_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_drug_tests_updated_at BEFORE UPDATE ON drug_alcohol_tests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_loads_updated_at BEFORE UPDATE ON loads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_dqf_documents_updated_at BEFORE UPDATE ON dqf_documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
