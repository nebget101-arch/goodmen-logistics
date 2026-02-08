@smoke @regression @audit
Feature: Audit API - Compliance Reports and Audit Trail

  Background:
    * url baseUrl
    * configure headers = headers

  @positive
  Scenario: Get audit trail
    Given path 'audit/trail'
    When method GET
    Then status 200
    And match response == '#array'
    And match each response == 
      """
      {
        id: '#number',
        timestamp: '#string',
        userId: '#number',
        userName: '#string',
        action: '#string',
        module: '#string',
        details: '#string'
      }
      """

  @positive
  Scenario: Generate compliance report
    Given path 'audit/compliance-report'
    When method GET
    Then status 200
    And match response == '#object'
    And match response.overallCompliance == '#number'
    And match response.modules == '#array'

  @positive
  Scenario: Export audit data
    Given path 'audit/export'
    And param format = 'json'
    When method GET
    Then status 200

  @fmcsa @compliance
  Scenario: Verify audit modules coverage
    Given path 'audit/compliance-report'
    When method GET
    Then status 200
    * def requiredModules = ['Driver Qualification', 'Hours of Service', 'Vehicle Maintenance', 'Drug & Alcohol Testing']
    * def reportModules = karate.map(response.modules, function(x){ return x.name })
    * print 'Modules in compliance report:', reportModules

  @performance
  Scenario: Audit trail response time
    Given path 'audit/trail'
    When method GET
    Then status 200
    And assert responseTime < 3000

  @dataValidation
  Scenario: Verify timestamp format in audit trail
    Given path 'audit/trail'
    When method GET
    Then status 200
    And match each response.timestamp == '#string'
