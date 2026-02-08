@smoke @regression @dashboard
Feature: Dashboard API - Statistics and Alerts

  Background:
    * url baseUrl
    * configure headers = headers

  @positive
  Scenario: Get dashboard statistics successfully
    Given path 'dashboard/stats'
    When method GET
    Then status 200
    And match response == '#object'
    And match response.totalDrivers == '#number'
    And match response.totalVehicles == '#number'
    And match response.activeLoads == '#number'
    And match response.completedLoads == '#number'
    And match response.criticalAlerts == '#number'
    And match response.complianceScore == '#number'
    And match response.complianceScore >= 0
    And match response.complianceScore <= 100

  @positive
  Scenario: Verify dashboard statistics data types
    Given path 'dashboard/stats'
    When method GET
    Then status 200
    And match response.totalDrivers == '#? _ >= 0'
    And match response.totalVehicles == '#? _ >= 0'
    And match response.activeLoads == '#? _ >= 0'
    And match response.completedLoads == '#? _ >= 0'
    And match response.criticalAlerts == '#? _ >= 0'

  @positive
  Scenario: Get dashboard alerts successfully
    Given path 'dashboard/alerts'
    When method GET
    Then status 200
    And match response == '#array'
    And match each response == 
      """
      {
        id: '#number',
        type: '#string',
        severity: '#string',
        message: '#string',
        date: '#string',
        module: '#string'
      }
      """

  @positive
  Scenario: Verify alert severity levels
    Given path 'dashboard/alerts'
    When method GET
    Then status 200
    And match response == '#array'
    * def severityLevels = ['critical', 'high', 'medium', 'low']
    And match each response.severity contains severityLevels

  @positive
  Scenario: Verify dashboard health check
    Given path 'health'
    When method GET
    Then status 200
    And match response == '#object'
    And match response.status == 'healthy'

  @performance
  Scenario: Dashboard statistics response time
    Given path 'dashboard/stats'
    When method GET
    Then status 200
    And assert responseTime < 2000

  @performance
  Scenario: Dashboard alerts response time
    Given path 'dashboard/alerts'
    When method GET
    Then status 200
    And assert responseTime < 2000

  @negative
  Scenario: Invalid dashboard endpoint
    Given path 'dashboard/invalid'
    When method GET
    Then status 404

  @dataValidation
  Scenario: Verify compliance score calculation
    Given path 'dashboard/stats'
    When method GET
    Then status 200
    And match response.complianceScore == '#number'
    And assert response.complianceScore >= 0 && response.complianceScore <= 100

  @dataValidation
  Scenario: Verify alert date format
    Given path 'dashboard/alerts'
    When method GET
    Then status 200
    And match each response.date == '#string'
    # Verify ISO date format or MM/DD/YYYY
    And match each response.date == '#regex \\d{4}-\\d{2}-\\d{2}|\\d{2}/\\d{2}/\\d{4}'
