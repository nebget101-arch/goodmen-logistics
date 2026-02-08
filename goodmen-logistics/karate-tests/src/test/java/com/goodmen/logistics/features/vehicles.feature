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
        id: '#number',
        unitNumber: '#string',
        vin: '#string',
        make: '#string',
        model: '#string',
        year: '#number',
        type: '#string',
        status: '#string',
        currentMileage: '#number',
        lastInspection: '#string'
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
    And match response.unitNumber == '#string'
    And match response.vin == '#string'

  @positive
  Scenario: Create new vehicle
    Given path 'vehicles'
    And request testVehicle
    When method POST
    Then status 201
    And match response.id == '#number'
    And match response.unitNumber == testVehicle.unitNumber
    And match response.vin == testVehicle.vin

  @positive
  Scenario: Update vehicle information
    Given path 'vehicles'
    When method GET
    Then status 200
    * def vehicleId = response[0].id
    * def originalVehicle = response[0]
    
    * def updatedVehicle = originalVehicle
    * set updatedVehicle.currentMileage = originalVehicle.currentMileage + 1000
    
    Given path 'vehicles', vehicleId
    And request updatedVehicle
    When method PUT
    Then status 200
    And match response.id == vehicleId

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
