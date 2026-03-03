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
    And match response.success == true
    And match response.data == '#array'
    And match each response.data == 
      """
      {
        id: '#string',
        load_number: '#string',
        status: '#string',
        billing_status: '#string',
        pickup_city: '#string',
        pickup_state: '#string',
        delivery_city: '#string',
        delivery_state: '#string',
        rate: '#number',
        completed_date: '##string',
        driver_name: '##string',
        broker_name: '##string',
        attachment_count: '#number',
        attachment_types: '#array'
      }
      """

  @positive
  Scenario: Get active loads
    Given path 'loads'
    When method GET
    Then status 200
    * def activeLoads = karate.filter(response.data, function(x){ return x.status == 'IN_TRANSIT' || x.status == 'DISPATCHED' })
    * print 'Active loads count:', activeLoads.length

  @positive
  Scenario: Get load by ID
    Given path 'loads'
    When method GET
    Then status 200
    * def loadId = response.data[0].id
    
    Given path 'loads', loadId
    When method GET
    Then status 200
    And match response.success == true
    And match response.data.id == loadId
    And match response.data.load_number == '#string'

  @dataValidation
  Scenario: Verify load status values
    Given path 'loads'
    When method GET
    Then status 200
    * def validStatuses = ['NEW', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED']
    And match each response.data.status contains validStatuses

  @performance
  Scenario: Loads list response time
    Given path 'loads'
    When method GET
    Then status 200
    And assert responseTime < 2000
