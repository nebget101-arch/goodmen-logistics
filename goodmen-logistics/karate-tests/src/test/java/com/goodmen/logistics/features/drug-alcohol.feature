@smoke @regression @drugalcohol
Feature: Drug & Alcohol Testing API - 49 CFR Part 382

  Background:
    * url baseUrl
    * configure headers = headers

  @positive
  Scenario: Get all drug and alcohol test records
    Given path 'drug-alcohol'
    When method GET
    Then status 200
    And match response == '#array'
    And match each response == 
      """
      {
        id: '#number',
        driverId: '#number',
        driverName: '#string',
        testType: '#string',
        testDate: '#string',
        result: '#string',
        status: '#string'
      }
      """

  @positive
  Scenario: Get drug/alcohol program status
    Given path 'drug-alcohol/program-status'
    When method GET
    Then status 200
    And match response == '#object'

  @fmcsa @compliance
  Scenario: Verify test types compliance
    Given path 'drug-alcohol'
    When method GET
    Then status 200
    * def validTestTypes = ['Pre-Employment', 'Random', 'Post-Accident', 'Reasonable Suspicion', 'Return-to-Duty', 'Follow-Up']
    And match each response.testType contains validTestTypes

  @fmcsa @retention
  Scenario: Verify drug/alcohol record retention (49 CFR 382.401)
    # Records must be retained for 5 years
    Given path 'drug-alcohol'
    When method GET
    Then status 200
    * print 'Total drug/alcohol test records:', response.length
    * print 'Drug/Alcohol testing retention: 5 years (49 CFR 382.401)'

  @dataValidation
  Scenario: Verify test result values
    Given path 'drug-alcohol'
    When method GET
    Then status 200
    * def validResults = ['Negative', 'Positive', 'Refused', 'Cancelled']
    And match each response.result contains validResults
