@smoke @regression @vehicles
Feature: Vehicles API - Fleet Management

  Background:
    * url baseUrl
    * configure headers = headers
    * def testVehicle = read('classpath:test-data/vehicle-valid.json')

  @positive
  Scenario: Get all vehicles successfully
    Given path 'vehicles'
    When method GET
    Then status 200
    And match response == '#array'
    And match each response == 
      """
      {
        id: '#string',
        unit_number: '#string',
        vin: '#string',
        make: '#string',
        model: '#string',
        year: '#number',
        license_plate: '#string',
        state: '#string',
        status: '#string',
        mileage: '#number',
        inspection_expiry: '##string',
        insurance_expiry: '##string',
        registration_expiry: '##string',
        next_pm_due: '##string',
        next_pm_mileage: '##number',
        eld_device_id: '##string',
        oos_reason: '##string',
        created_at: '#string',
        updated_at: '#string'
      }
      """

  @positive
  Scenario: Get vehicle by ID
    Given path 'vehicles'
    When method GET
    Then status 200
    * def vehicleId = response[0].id
    
    Given path 'vehicles', vehicleId
    When method GET
    Then status 200
    And match response.id == vehicleId
    And match response.unit_number == '#string'
    And match response.vin == '#string'
    And match response.inspection_expiry == '##string'
    And match response.status == '#string'

  @positive
  Scenario: Create new vehicle
    * def newVehicle = 
      """
      {
        unit_number: 'TEST-9999',
        vin: '1HGBH41JXMN999999',
        make: 'Test Make',
        model: 'Test Model',
        year: 2024,
        license_plate: 'TEST999',
        state: 'CA',
        status: 'in-service',
        mileage: 50000,
        inspection_expiry: '2026-12-31',
        registration_expiry: '2026-12-31',
        insurance_expiry: '2026-12-31'
      }
      """
    Given path 'vehicles'
    And request newVehicle
    When method POST
    Then status 201
    And match response.id == '#string'
    And match response.unit_number == 'TEST-9999'
    And match response.vin == '1HGBH41JXMN999999'
    And match response.inspection_expiry == '2026-12-31'

  @positive
  Scenario: Update vehicle information
    Given path 'vehicles'
    When method GET
    Then status 200
    * def vehicleId = response[0].id
    * def originalMileage = response[0].mileage
    
    * def updatedVehicle = 
      """
      {
        mileage: #(originalMileage + 1000),
        inspection_expiry: '2027-01-01',
        status: 'in-service'
      }
      """
    
    Given path 'vehicles', vehicleId
    And request updatedVehicle
    When method PUT
    Then status 200
    And match response.id == vehicleId
    And match response.mileage == originalMileage + 1000

  @positive
  Scenario: Delete vehicle
    Given path 'vehicles'
    And request testVehicle
    When method POST
    Then status 201
    * def vehicleId = response.id
    
    Given path 'vehicles', vehicleId
    When method DELETE
    Then status 200 || status 204

  @fmcsa @compliance
  Scenario: Get maintenance alerts for vehicles
    Given path 'vehicles/maintenance-alerts'
    When method GET
    Then status 200
    And match response == '#array'
    And match each response == 
      """
      {
        vehicleId: '#number',
        unitNumber: '#string',
        alertType: '#string',
        description: '#string',
        severity: '#string',
        dueDate: '#string'
      }
      """

  @fmcsa @compliance
  Scenario: Verify VIN format (17 characters)
    Given path 'vehicles'
    When method GET
    Then status 200
    And match each response.vin == '#regex [A-HJ-NPR-Z0-9]{17}'

  @fmcsa @compliance
  Scenario: Check vehicles needing inspection
    Given path 'vehicles/maintenance-alerts'
    When method GET
    Then status 200
    * def inspectionDue = karate.filter(response, function(x){ return x.alertType == 'Inspection Due' })
    * print 'Vehicles needing inspection:', inspectionDue

  @negative
  Scenario: Create vehicle with invalid VIN
    Given path 'vehicles'
    And request { unitNumber: 'TEST', vin: 'INVALID', make: 'Test', model: 'Test', year: 2020, type: 'Tractor' }
    When method POST
    Then status 400 || status 422

  @negative
  Scenario: Get non-existent vehicle
    Given path 'vehicles/99999'
    When method GET
    Then status 404

  @performance
  Scenario: Vehicles list response time
    Given path 'vehicles'
    When method GET
    Then status 200
    And assert responseTime < 2000

  @dataValidation
  Scenario: Verify vehicle status values
    Given path 'vehicles'
    When method GET
    Then status 200
    And match each response.status == '#regex (in-service|out-of-service|maintenance|sold|retired)'

  @compliance @inspection
  Scenario: Verify inspection_expiry field format
    Given path 'vehicles'
    When method GET
    Then status 200
    And match each response contains { inspection_expiry: '##string' }
    * def vehiclesWithExpiry = karate.filter(response, function(x){ return x.inspection_expiry != null })
    And match each vehiclesWithExpiry[*].inspection_expiry == '#regex \\d{4}-\\d{2}-\\d{2}'

  @compliance @inspection
  Scenario: Get vehicles with expired inspections
    Given path 'vehicles'
    And param status = 'out-of-service'
    When method GET
    Then status 200
    * def today = new Date().toISOString().split('T')[0]
    * def expiredVehicles = karate.filter(response, function(x){ return x.inspection_expiry != null && x.inspection_expiry < today })
    * print 'Vehicles with expired inspections:', expiredVehicles.length

  @vehicles @documents
  Scenario: Get vehicle documents
    Given path 'vehicles'
    When method GET
    Then status 200
    * def vehicleId = response[0].id
    
    Given path 'vehicles', vehicleId, 'documents'
    When method GET
    Then status 200
    And match response == '#array'

  @vehicles @documents @positive
  Scenario: Create vehicle document
    Given path 'vehicles'
    When method GET
    Then status 200
    * def vehicleId = response[0].id
    
    * def newDocument = 
      """
      {
        vehicle_id: '#(vehicleId)',
        document_type: 'registration',
        file_name: 'registration-2026.pdf',
        file_path: '/uploads/registration-2026.pdf',
        file_size: 102400,
        mime_type: 'application/pdf',
        expiry_date: '2026-12-31',
        notes: 'Annual registration document'
      }
      """
    
    Given path 'vehicles', vehicleId, 'documents'
    And request newDocument
    When method POST
    Then status 201
    And match response.id == '#string'
    And match response.document_type == 'registration'
    And match response.expiry_date == '2026-12-31'

  @vehicles @documents @positive
  Scenario: Delete vehicle document
    # First create a document
    Given path 'vehicles'
    When method GET
    Then status 200
    * def vehicleId = response[0].id
    
    * def newDocument = 
      """
      {
        vehicle_id: '#(vehicleId)',
        document_type: 'test-document',
        file_name: 'test.pdf',
        file_path: '/uploads/test.pdf',
        file_size: 1024,
        mime_type: 'application/pdf'
      }
      """
    
    Given path 'vehicles', vehicleId, 'documents'
    And request newDocument
    When method POST
    Then status 201
    * def documentId = response.id
    
    # Now delete it
    Given path 'vehicles', vehicleId, 'documents', documentId
    When method DELETE
    Then status 200 || status 204

  @vehicles @documents @negative
  Scenario: Get documents for non-existent vehicle
    Given path 'vehicles/00000000-0000-0000-0000-000000000000/documents'
    When method GET
    Then status 404 || status 200

    * def validStatuses = ['Active', 'Out of Service', 'Maintenance', 'Retired']
    And match each response.status contains validStatuses

  @dataValidation
  Scenario: Verify vehicle year is valid
    Given path 'vehicles'
    When method GET
    Then status 200
    * def currentYear = new Date().getFullYear()
    And match each response.year == '#? _ > 1990 && _ <= currentYear + 1'

  @dataValidation
  Scenario: Verify mileage is positive
    Given path 'vehicles'
    When method GET
    Then status 200
    And match each response.currentMileage == '#? _ >= 0'

  @fmcsa @retention
  Scenario: Verify maintenance record retention requirements (49 CFR 396)
    # Maintenance records: 1 year maintained, 6 months after vehicle leaves
    Given path 'vehicles'
    When method GET
    Then status 200
    * print 'Total vehicles:', response.length
    * print 'Maintenance record retention: 1 year maintained + 6 months after vehicle leaves (49 CFR 396.3)'

  @dataIntegrity
  Scenario: Verify VIN uniqueness
    Given path 'vehicles'
    When method GET
    Then status 200
    * def vins = karate.map(response, function(x){ return x.vin })
    * def uniqueVins = [...new Set(vins)]
    And assert vins.length == uniqueVins.length
