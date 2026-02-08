@smoke @regression @loads
Feature: Loads API - Dispatch Management

  Background:
    * url baseUrl
    * configure headers = headers

  @positive
  Scenario: Get all loads
    Given path 'loads'
    When method GET
    Then status 200
    And match response == '#array'
    And match each response == 
      """
      {
        id: '#number',
        loadNumber: '#string',
        status: '#string',
        origin: '#string',
        destination: '#string',
        pickupDate: '#string',
        deliveryDate: '#string'
      }
      """

  @positive
  Scenario: Get active loads
    Given path 'loads'
    When method GET
    Then status 200
    * def activeLoads = karate.filter(response, function(x){ return x.status == 'In Transit' || x.status == 'Dispatched' })
    * print 'Active loads count:', activeLoads.length

  @positive
  Scenario: Get load by ID
    Given path 'loads'
    When method GET
    Then status 200
    * def loadId = response[0].id
    
    Given path 'loads', loadId
    When method GET
    Then status 200
    And match response.id == loadId
    And match response.loadNumber == '#string'

  @dataValidation
  Scenario: Verify load status values
    Given path 'loads'
    When method GET
    Then status 200
    * def validStatuses = ['Available', 'Dispatched', 'In Transit', 'Delivered', 'Cancelled']
    And match each response.status contains validStatuses

  @performance
  Scenario: Loads list response time
    Given path 'loads'
    When method GET
    Then status 200
    And assert responseTime < 2000
