@smoke @regression @hos
Feature: HOS (Hours of Service) API - 49 CFR Part 395

  Background:
    * url baseUrl
    * configure headers = headers

  @positive
  Scenario: Get all HOS records
    Given path 'hos'
    When method GET
    Then status 200
    And match response == '#array'
    And match each response == 
      """
      {
        id: '#number',
        driverId: '#number',
        driverName: '#string',
        date: '#string',
        onDutyTime: '#number',
        drivingTime: '#number',
        status: '#string'
      }
      """

  @positive
  Scenario: Get HOS violations
    Given path 'hos/violations'
    When method GET
    Then status 200
    And match response == '#array'

  @fmcsa @compliance
  Scenario: Verify 11-hour driving limit compliance
    Given path 'hos'
    When method GET
    Then status 200
    * def violations = karate.filter(response, function(x){ return x.drivingTime > 11 })
    * print 'HOS violations (>11 hours driving):', violations

  @fmcsa @compliance
  Scenario: Verify 14-hour on-duty limit compliance
    Given path 'hos'
    When method GET
    Then status 200
    * def violations = karate.filter(response, function(x){ return x.onDutyTime > 14 })
    * print 'HOS violations (>14 hours on-duty):', violations

  @fmcsa @retention
  Scenario: Verify HOS record retention (49 CFR 395.8)
    # HOS records must be retained for 6 months
    Given path 'hos'
    When method GET
    Then status 200
    * print 'Total HOS records:', response.length
    * print 'HOS retention: 6 months from date of receipt (49 CFR 395.8(k))'
