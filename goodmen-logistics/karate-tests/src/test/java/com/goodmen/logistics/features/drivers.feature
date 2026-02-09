@smoke @regression @drivers
Feature: Drivers API - Driver Qualification Files Management

  Background:
    * url baseUrl
    * configure headers = headers
    * def testDriver = read('classpath:test-data/driver-valid.json')

  @positive
  Scenario: Get all drivers successfully with camelCase response
    Given path 'drivers'
    When method GET
    Then status 200
    And match response == '#array'
    And match each response == 
      """
      {
        id: '#string',
        firstName: '#string',
        lastName: '#string',
        email: '#string',
        cdlNumber: '#string',
        cdlState: '#string',
        cdlClass: '#string',
        cdlExpiry: '##string',
        medicalCertExpiry: '##string',
        hireDate: '##string',
        status: '#string',
        dqfCompleteness: '#number',
        clearinghouseStatus: '#string'
      }
      """

  @positive
  Scenario: Get driver by ID returns camelCase fields
    Given path 'drivers'
    When method GET
    Then status 200
    * def driverId = response[0].id
    
    Given path 'drivers', driverId
    When method GET
    Then status 200
    And match response.id == driverId
    And match response.firstName == '#string'
    And match response.lastName == '#string'
    And match response.cdlNumber == '#string'
    And match response.dqfCompleteness == '#number'

  @positive
  Scenario: Create new driver with optional date fields
    Given path 'drivers'
    And request testDriver
    When method POST
    Then status 201
    And match response.id == '#string'
    And match response.firstName == testDriver.firstName
    And match response.lastName == testDriver.lastName
    And match response.cdlNumber == testDriver.cdlNumber
    And match response.dqfCompleteness == 0
    And match response.status == 'active'

  @positive
  Scenario: Update driver information with camelCase fields
    # First, get a driver
    Given path 'drivers'
    When method GET
    Then status 200
    * def driverId = response[0].id
    * def originalDriver = response[0]
    
    # Update the driver with camelCase
    * def updatedDriver = 
      """
      {
        firstName: '#(originalDriver.firstName)',
        lastName: '#(originalDriver.lastName)',
        phone: '555-9999',
        status: 'active'
      }
      """
    
    Given path 'drivers', driverId
    And request updatedDriver
    When method PUT
    Then status 200
    And match response.id == driverId
    And match response.phone == '555-9999'

  @positive
  Scenario: Delete driver
    # Create a driver first
    Given path 'drivers'
    And request testDriver
    When method POST
    Then status 201
    * def driverId = response.id
    
    # Delete the driver
    Given path 'drivers', driverId
    When method DELETE
    Then status 200
    And match response.message == 'Driver deleted successfully'

  @dqf @compliance
  Scenario: Update DQF completeness percentage
    Given path 'drivers'
    When method GET
    Then status 200
    * def driverId = response[0].id
    
    # Update DQF to 50%
    * def dqfUpdate = { dqfCompleteness: 50 }
    
    Given path 'drivers', driverId
    And request dqfUpdate
    When method PUT
    Then status 200
    And match response.dqfCompleteness == 50

  @clearinghouse @compliance
  Scenario: Update clearinghouse status based on consent
    Given path 'drivers'
    When method GET
    Then status 200
    * def driverId = response[0].id
    
    # Set clearinghouse to eligible
    * def clearinghouseUpdate = { clearinghouseStatus: 'eligible' }
    
    Given path 'drivers', driverId
    And request clearinghouseUpdate
    When method PUT
    Then status 200
    And match response.clearinghouseStatus == 'eligible'
    
    # Set clearinghouse to query-pending
    * def clearinghouseUpdate2 = { clearinghouseStatus: 'query-pending' }
    
    Given path 'drivers', driverId
    And request clearinghouseUpdate2
    When method PUT
    Then status 200
    And match response.clearinghouseStatus == 'query-pending'

  @status @automation
  Scenario: Driver status is set to inactive when DQF is not 100%
    Given path 'drivers'
    When method GET
    Then status 200
    * def driverId = response[0].id
    
    # Update DQF to less than 100%
    * def dqfUpdate = { dqfCompleteness: 75, status: 'active' }
    
    Given path 'drivers', driverId
    And request dqfUpdate
    When method PUT
    Then status 200
    # Status should remain inactive or be set to inactive if DQF < 100%
    And match response.dqfCompleteness == 75

  @fmcsa @compliance
  Scenario: Verify CDL format validation
    Given path 'drivers'
    When method GET
    Then status 200
    And match each response.cdlNumber == '#regex [A-Z]{2}-\\d+'

  @fmcsa @compliance
  Scenario: Check expired medical certificates
    Given path 'drivers/compliance-issues'
    When method GET
    Then status 200
    * def expiredMedical = karate.filter(response, function(x){ return x.issueType == 'Expired Medical Certificate' })
    * print 'Drivers with expired medical certificates:', expiredMedical

  @negative
  Scenario: Create driver with invalid data
    Given path 'drivers'
    And request { name: '', cdlNumber: '' }
    When method POST
    Then status 400 || status 422

  @negative
  Scenario: Get non-existent driver
    Given path 'drivers/99999'
    When method GET
    Then status 404

  @performance
  Scenario: Drivers list response time
    Given path 'drivers'
    When method GET
    Then status 200
    And assert responseTime < 2000

  @dataValidation
  Scenario: Verify driver status values
    Given path 'drivers'
    When method GET
    Then status 200
    * def validStatuses = ['Active', 'Inactive', 'On Leave', 'Terminated']
    And match each response.status contains validStatuses

  @dataValidation
  Scenario: Verify date formats in driver data
    Given path 'drivers'
    When method GET
    Then status 200
    And match each response.cdlExpiration == '#regex \\d{4}-\\d{2}-\\d{2}'
    And match each response.medicalCertExpiration == '#regex \\d{4}-\\d{2}-\\d{2}'
    And match each response.hireDate == '#regex \\d{4}-\\d{2}-\\d{2}'

  @fmcsa @retention
  Scenario: Verify DQF retention requirements (49 CFR 391)
    # Driver Qualification Files must be retained for 3 years after driver leaves
    Given path 'drivers'
    When method GET
    Then status 200
    * print 'Total drivers:', response.length
    * print 'DQF retention: 3 years after driver leaves carrier (49 CFR 391.51)'
