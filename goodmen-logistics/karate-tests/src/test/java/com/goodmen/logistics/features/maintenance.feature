@smoke @regression @maintenance
Feature: Maintenance API - Vehicle Maintenance Management

  Background:
    * url baseUrl
    * configure headers = headers

  @positive
  Scenario: Get all maintenance records
    Given path 'maintenance'
    When method GET
    Then status 200
    And match response == '#array'
    And match each response == 
      """
      {
        id: '#number',
        vehicleId: '#number',
        unitNumber: '#string',
        workOrderNumber: '#string',
        date: '#string',
        type: '#string',
        status: '#string',
        cost: '#number'
      }
      """

  @positive
  Scenario: Get maintenance schedule
    Given path 'maintenance/schedule'
    When method GET
    Then status 200
    And match response == '#array'

  @positive
  Scenario: Get maintenance by vehicle ID
    # First get a vehicle
    Given path 'vehicles'
    When method GET
    Then status 200
    * def vehicleId = response[0].id
    
    # Get maintenance for that vehicle
    Given path 'maintenance/vehicle', vehicleId
    When method GET
    Then status 200
    And match response == '#array'

  @fmcsa @compliance
  Scenario: Verify maintenance record completeness
    Given path 'maintenance'
    When method GET
    Then status 200
    And match each response.workOrderNumber == '#string'
    And match each response.date == '#string'
    And match each response.type == '#string'

  @performance
  Scenario: Maintenance records response time
    Given path 'maintenance'
    When method GET
    Then status 200
    And assert responseTime < 3000
