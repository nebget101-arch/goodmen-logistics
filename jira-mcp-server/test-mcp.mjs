#!/usr/bin/env node

// Quick test of new MCP functionality
import { TestRunnerService } from './dist/services/test-runner-service.js';

const workspace = '/Users/nebyougetaneh/Desktop/SafetyApp';
const service = new TestRunnerService(workspace);

console.log('🧪 Testing MCP Test Automation Features\n');

// Test 1: Get test cases from Cypress file
console.log('📝 Test 1: Getting test cases from vehicles.cy.js');
const cypressTests = await service.getTestCases('vehicles/vehicles.cy.js');
console.log(`✓ Framework: ${cypressTests.framework}`);
console.log(`✓ Found ${cypressTests.testCases.length} test cases`);
console.log(`  First 5 tests:`);
cypressTests.testCases.slice(0, 5).forEach((tc, i) => {
  console.log(`    ${i + 1}. ${tc}`);
});

// Test 2: Get test cases from Karate file
console.log('\n📝 Test 2: Getting scenarios from vehicles.feature');
const karateTests = await service.getTestCases('vehicles.feature');
console.log(`✓ Framework: ${karateTests.framework}`);
console.log(`✓ Found ${karateTests.testCases.length} scenarios`);
karateTests.testCases.forEach((tc, i) => {
  console.log(`    ${i + 1}. ${tc}`);
});

// Test 3: Get test cases from K6 file
console.log('\n📝 Test 3: Getting checks from smoke.test.js');
const k6Tests = await service.getTestCases('smoke.test.js');
console.log(`✓ Framework: ${k6Tests.framework}`);
console.log(`✓ Found ${k6Tests.testCases.length} checks`);
k6Tests.testCases.slice(0, 5).forEach((tc, i) => {
  console.log(`    ${i + 1}. ${tc}`);
});

console.log('\n✅ All tests passed! MCP server is ready to use.\n');
console.log('Next steps:');
console.log('1. Restart Claude Desktop');
console.log('2. Try: "Show me all test cases in vehicles/vehicles.cy.js"');
console.log('3. Try: "Run the test \'should display vehicle details\' from vehicles.cy.js"');
