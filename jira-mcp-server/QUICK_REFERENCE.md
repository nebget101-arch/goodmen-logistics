# JIRA MCP Server - Quick Reference

## Test Automation Commands

### Discovery
```
"Show me all available tests"
"List all Cypress tests"
"What K6 tests do we have?"

# NEW: Get individual test cases
"Show me all test cases in vehicles.cy.js"
"List test cases in vehicles/vehicles.cy.js"
"What scenarios are in vehicles.feature?"
```

### Cypress E2E Tests
```
# Run all tests
"Run all Cypress tests"

# Run specific tests
"Run Cypress vehicle tests"
"Run Cypress tests for drivers"
"Run Cypress tests matching **/loads*.cy.js"

# NEW: Run specific test case
"Run the test 'should display vehicle details' in vehicles.cy.js"
"Run only 'should load vehicles page successfully' from vehicles.cy.js"
"Execute the 'should sort by inspection expiry' test"

# With bug creation
"Run Cypress vehicle tests and create bugs"
"Run all Cypress tests and create bugs for failures"

# With Confluence report
"Run Cypress vehicle tests and generate Confluence report"

# Complete workflow
"Run Cypress vehicle tests, create bugs, and generate Confluence report"
```

### Karate API Tests
```
# Run all tests
"Run all Karate tests"

# Run with tags
"Run Karate tests tagged @smoke"
"Run Karate @regression tests"
"Execute Karate tests with @critical tag"

# NEW: Run specific scenario
"Run the scenario 'Get vehicle by ID' in Karate"
"Execute 'Create new vehicle' scenario"
"Run Karate scenario named 'Update vehicle status'"

# With bug creation
"Run Karate smoke tests and create bugs"
"Run all Karate tests with bug creation"

# With Confluence report
"Run Karate API tests and create Confluence report"

# Complete workflow
"Run Karate smoke tests, create bugs, and generate report"
```

### K6 Performance Tests
```
# Run specific script
"Run K6 smoke test"
"Run K6 load test"
"Execute K6 stress test"

# With Confluence report
"Run K6 smoke test and create Confluence report"
"Run K6 load test with documentation"

# Run all performance tests
"Run all K6 tests"
"Execute all K6 performance tests"
```

## Story & Epic Creation

### User Stories
```
# Basic story
"Create a user story for: Add vehicle inspection scheduling"

# With details
"Create a user story for driver license expiration alerts with acceptance criteria:
- Alert displays 30 days before expiration
- Email notification sent to admin
- Dashboard shows all expiring licenses"

# Link to epic
"Create a user story for vehicle maintenance tracking, link to epic SA-45"
```

### Epics
```
"Create an epic for Vehicle Maintenance Module with description: Implement comprehensive vehicle maintenance tracking and scheduling features"

"Create an epic for Driver Safety Features"
```

## Bug Creation & Analysis

### Manual Bug Creation
```
# Analyze test failure
"Analyze this test failure: test name 'Driver API returns 500', error 'null pointer exception in getDriverById'"

# Auto-create if it's a bug
"Analyze test failure 'Vehicle creation fails' with error 'Cannot read property id of null' and create bug if confirmed"
```

### Batch Analysis
```
# Analyze all failures
"Analyze all test failures"

# Analyze and create bugs
"Analyze all test failures and create bugs for actual defects"
```

## Search & Queries

### JIRA Search
```
"Search JIRA for all bugs with priority High"
"Find all open issues in project SA"
"Search for bugs created this week"
```

## Common Workflows

### Complete CI/CD Test Run
```
"Run all Cypress tests, create bugs for failures, and generate Confluence report"
```
**Result:** Full test execution → AI analysis → Bug creation → Documentation

### Smoke Test with Reporting
```
"Run Karate smoke tests and Cypress vehicle tests with Confluence reports"
```
**Result:** Quick validation → Stakeholder documentation

### Performance Monitoring
```
"Run K6 smoke test and create Confluence report"
```
**Result:** Performance metrics → Historical tracking

### Feature Validation
```
1. "Run Cypress tests for vehicles"
2. If failures: "Analyze failures and create bugs"
3. "Generate Confluence report for vehicle test results"
```

### Release Testing
```
1. "Run Karate tests tagged @regression"
2. "Run all Cypress tests"
3. "Run K6 load test"
4. "Create Confluence reports for all test runs"
```

## Parameter Patterns

### Cypress specPattern
```
**/vehicles*.cy.js      # All vehicle tests
**/drivers*.cy.js       # All driver tests
**/loads*.cy.js         # All load tests
**/*.cy.js              # All Cypress tests
vehicles.cy.js          # Exact file
```

### Karate Tags
```
@smoke          # Smoke tests
@regression     # Regression tests
@critical       # Critical tests
@api            # API tests
@slow           # Slow tests
```

### K6 Scripts
```
smoke.test.js   # Quick validation (10 VUs, 1 min)
load.test.js    # Normal load (50 VUs, 5 min)
stress.test.js  # Stress testing (100+ VUs, 10 min)
soak.test.js    # Long duration (30 VUs, 1 hour)
spike.test.js   # Sudden traffic spike
```

## Flags & Options

### createBugs
- `false` (default): Only report failures
- `true`: Create JIRA bugs for confirmed code defects

### createConfluenceReport
- `false` (default): No documentation
- `true`: Generate Confluence page with results

## Expected Responses

### Test Execution
```json
{
  "framework": "Cypress",
  "total": 24,
  "passed": 18,
  "failed": 6,
  "pending": 0,
  "duration": "45s",
  "successRate": "75%",
  "failures": [...],
  "createdBugs": ["SA-123", "SA-124"],
  "confluenceUrl": "https://domain.atlassian.net/wiki/spaces/SA/pages/123456"
}
```

### Bug Analysis
```json
{
  "isActualBug": true,
  "category": "Code Defect",
  "confidence": "High",
  "severity": "High",
  "reasoning": "Null pointer exception in production code",
  "bugKey": "SA-123"
}
```

## Error Messages

| Message | Meaning | Solution |
|---------|---------|----------|
| "Command failed: cypress run" | Cypress not installed | `cd cypress-tests && npm install` |
| "No test specs found" | Wrong specPattern | Check pattern syntax |
| "Maven build failed" | Karate compilation error | Fix Java/feature file syntax |
| "k6 command not found" | K6 not installed | Install from k6.io |
| "Failed to create Jira issue" | JIRA auth failed | Check credentials in .env |
| "Confluence page creation failed" | Confluence auth failed | Verify Confluence config (optional) |

## Tips

✅ **DO:**
- Use specific patterns for faster execution
- Enable bug creation in CI/CD pipelines
- Generate Confluence reports for releases
- Review AI analysis for accuracy

❌ **DON'T:**
- Run all tests unnecessarily
- Auto-create bugs without reviewing analysis
- Use Confluence for every test run (optional)
- Ignore test/environment issues

## Time Estimates

| Action | Duration |
|--------|----------|
| List available tests | < 1s |
| Run Cypress vehicle tests (29 tests) | ~45s |
| Run all Cypress tests | ~2 min |
| Run Karate smoke tests | ~30s |
| Run K6 smoke test | ~1 min |
| Bug creation (per failure) | ~2s |
| Confluence report generation | ~3s |

## Configuration Files

| File | Purpose |
|------|---------|
| `.env` | JIRA/Confluence credentials |
| `cypress.config.js` | Cypress baseUrl and settings |
| `karate-config.js` | Karate API baseUrl |
| `k6-performance-tests/config/config.js` | K6 thresholds |
| `tsconfig.json` | TypeScript compilation |
| `package.json` | Dependencies |

## Logs & Debugging

### Check Logs
```bash
# Claude Desktop logs
tail -f ~/Library/Logs/Claude/mcp*.log

# MCP Server output
# Logged to Claude Desktop console

# Test framework logs
cat cypress-tests/cypress/videos/*.mp4  # Cypress videos
cat karate-tests/target/surefire-reports/*.xml  # Karate reports
cat k6-performance-tests/reports/*.json  # K6 reports
```

### Debug Mode
Set environment variable for verbose logging:
```env
DEBUG=true
```

## Version Requirements

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 18+ | Required for MCP server |
| Cypress | 13.6.2 | E2E testing |
| Karate | 1.4.1 | Requires Java 17 |
| Maven | 3.9+ | For Karate tests |
| K6 | 0.48+ | Performance testing |
| Java | 17 | For Karate (not 21) |

## Links

- [README.md](README.md) - Full documentation
- [TEST_AUTOMATION_GUIDE.md](TEST_AUTOMATION_GUIDE.md) - Detailed guide
- [.env.example](.env.example) - Configuration template
- [Cypress Docs](https://docs.cypress.io)
- [Karate Docs](https://github.com/karatelabs/karate)
- [K6 Docs](https://k6.io/docs)
