/**
 * Generate HTML Performance Report
 * 
 * Converts JSON test results into a beautiful HTML report
 * with charts, tables, and detailed metrics.
 * 
 * Usage:
 *   node scripts/generate-html-report.js
 *   node scripts/generate-html-report.js --test=load
 */

const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');

function parseArgs() {
  const args = { testType: 'all' };
  process.argv.forEach(arg => {
    if (arg.startsWith('--test=')) args.testType = arg.split('=')[1];
  });
  return args;
}

function generateHTML(reportData) {
  const timestamp = new Date(reportData.generatedAt).toLocaleString();
  const testsRun = reportData.summary.testsRun;
  const overallStatus = reportData.summary.overallStatus;
  
  // Get available tests
  const availableTests = Object.entries(reportData.tests)
    .filter(([_, data]) => data !== null)
    .map(([name, _]) => name);

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Performance Test Report - Goodmen Logistics</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 20px;
      color: #333;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      overflow: hidden;
    }
    
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 40px;
      text-align: center;
    }
    
    .header h1 {
      font-size: 2.5em;
      margin-bottom: 10px;
    }
    
    .header p {
      font-size: 1.1em;
      opacity: 0.9;
    }
    
    .status-badge {
      display: inline-block;
      padding: 10px 20px;
      border-radius: 25px;
      font-weight: bold;
      margin-top: 15px;
      font-size: 1.2em;
    }
    
    .status-pass {
      background: #10b981;
      color: white;
    }
    
    .status-fail {
      background: #ef4444;
      color: white;
    }
    
    .status-partial {
      background: #f59e0b;
      color: white;
    }
    
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      padding: 40px;
      background: #f9fafb;
    }
    
    .summary-card {
      background: white;
      padding: 25px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      border-left: 4px solid #667eea;
    }
    
    .summary-card h3 {
      color: #667eea;
      font-size: 0.9em;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 10px;
    }
    
    .summary-card .value {
      font-size: 2.5em;
      font-weight: bold;
      color: #333;
    }
    
    .content {
      padding: 40px;
    }
    
    .test-section {
      margin-bottom: 40px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
    }
    
    .test-header {
      background: #f3f4f6;
      padding: 20px;
      border-bottom: 2px solid #e5e7eb;
    }
    
    .test-header h2 {
      color: #333;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .test-body {
      padding: 25px;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    
    th {
      background: #667eea;
      color: white;
      padding: 12px;
      text-align: left;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 0.85em;
      letter-spacing: 0.5px;
    }
    
    td {
      padding: 12px;
      border-bottom: 1px solid #e5e7eb;
    }
    
    tr:hover {
      background: #f9fafb;
    }
    
    .metric-good { color: #10b981; font-weight: bold; }
    .metric-warning { color: #f59e0b; font-weight: bold; }
    .metric-bad { color: #ef4444; font-weight: bold; }
    
    .recommendations {
      background: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 20px;
      border-radius: 8px;
      margin: 20px 0;
    }
    
    .recommendations h3 {
      color: #92400e;
      margin-bottom: 15px;
    }
    
    .recommendation-item {
      margin: 15px 0;
      padding: 15px;
      background: white;
      border-radius: 6px;
    }
    
    .priority-high { border-left: 4px solid #ef4444; }
    .priority-medium { border-left: 4px solid #f59e0b; }
    .priority-low { border-left: 4px solid #10b981; }
    .priority-info { border-left: 4px solid #3b82f6; }
    
    .footer {
      background: #f3f4f6;
      padding: 30px;
      text-align: center;
      color: #6b7280;
      font-size: 0.9em;
    }
    
    .chart-container {
      margin: 30px 0;
      padding: 20px;
      background: #f9fafb;
      border-radius: 8px;
    }
    
    .progress-bar {
      background: #e5e7eb;
      border-radius: 10px;
      height: 30px;
      overflow: hidden;
      margin: 10px 0;
    }
    
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #10b981, #059669);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
      font-size: 0.9em;
    }
    
    @media print {
      body { background: white; padding: 0; }
      .container { box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 Performance Test Report</h1>
      <p>Goodmen Logistics Safety App</p>
      <p style="font-size: 0.9em; margin-top: 10px;">Generated: ${timestamp}</p>
      <div class="status-badge status-${overallStatus.includes('✅') ? 'pass' : overallStatus.includes('❌') ? 'fail' : 'partial'}">
        ${overallStatus}
      </div>
    </div>
    
    <div class="summary">
      <div class="summary-card">
        <h3>Tests Executed</h3>
        <div class="value">${testsRun}</div>
      </div>
      <div class="summary-card">
        <h3>Test Types</h3>
        <div class="value">${availableTests.join(', ').toUpperCase()}</div>
      </div>
      <div class="summary-card">
        <h3>Overall Status</h3>
        <div class="value">${overallStatus.includes('PASS') ? '✅ PASS' : overallStatus.includes('FAIL') ? '❌ FAIL' : '⚠️ PARTIAL'}</div>
      </div>
    </div>
    
    <div class="content">`;

  // Add each test section
  for (const testType of availableTests) {
    const testData = reportData.tests[testType];
    if (!testData) continue;

    const metrics = testData.metrics;
    const totalRequests = metrics?.http_reqs?.values?.count || 0;
    const failedRequests = metrics?.http_req_failed?.values?.passes || 0;
    const errorRate = metrics?.http_req_failed?.values?.rate ? (metrics.http_req_failed.values.rate * 100).toFixed(2) : '0.00';
    const avgDuration = metrics?.http_req_duration?.values?.avg?.toFixed(2) || 'N/A';
    const p95Duration = metrics?.http_req_duration?.values?.['p(95)']?.toFixed(2) || 'N/A';
    const p99Duration = metrics?.http_req_duration?.values?.['p(99)']?.toFixed(2) || 'N/A';
    const minDuration = metrics?.http_req_duration?.values?.min?.toFixed(2) || 'N/A';
    const maxDuration = metrics?.http_req_duration?.values?.max?.toFixed(2) || 'N/A';
    const medDuration = metrics?.http_req_duration?.values?.med?.toFixed(2) || 'N/A';
    const checksPass = metrics?.checks?.values?.passes || 0;
    const checksFail = metrics?.checks?.values?.fails || 0;
    const throughput = metrics?.http_reqs?.values?.rate?.toFixed(2) || 'N/A';
    const duration = testData.state?.testRunDurationMs ? (testData.state.testRunDurationMs / 1000).toFixed(1) : 'N/A';
    
    const successRate = totalRequests > 0 ? (((totalRequests - failedRequests) / totalRequests) * 100).toFixed(1) : '100';
    const checkSuccessRate = (checksPass + checksFail) > 0 ? ((checksPass / (checksPass + checksFail)) * 100).toFixed(1) : '100';
    
    html += `
      <div class="test-section">
        <div class="test-header">
          <h2>${testType.toUpperCase()} Test Results</h2>
        </div>
        <div class="test-body">
          <div class="chart-container">
            <h3>Request Success Rate</h3>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${successRate}%">${successRate}%</div>
            </div>
            <h3 style="margin-top: 20px;">Check Success Rate</h3>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${checkSuccessRate}%">${checkSuccessRate}%</div>
            </div>
          </div>
          
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Test Duration</td>
                <td>${duration}s</td>
                <td>ℹ️</td>
              </tr>
              <tr>
                <td>Total Requests</td>
                <td>${totalRequests}</td>
                <td>✅</td>
              </tr>
              <tr>
                <td>Failed Requests</td>
                <td>${failedRequests}</td>
                <td class="${failedRequests === 0 ? 'metric-good' : 'metric-bad'}">${failedRequests === 0 ? '✅' : '❌'}</td>
              </tr>
              <tr>
                <td>Error Rate</td>
                <td>${errorRate}%</td>
                <td class="${parseFloat(errorRate) < 1 ? 'metric-good' : 'metric-bad'}">${parseFloat(errorRate) < 1 ? '✅' : '❌'}</td>
              </tr>
              <tr>
                <td>Avg Response Time</td>
                <td>${avgDuration}ms</td>
                <td class="${parseFloat(avgDuration) < 200 ? 'metric-good' : parseFloat(avgDuration) < 500 ? 'metric-warning' : 'metric-bad'}">
                  ${parseFloat(avgDuration) < 200 ? '✅' : parseFloat(avgDuration) < 500 ? '⚠️' : '❌'}
                </td>
              </tr>
              <tr>
                <td>Min Response Time</td>
                <td>${minDuration}ms</td>
                <td>ℹ️</td>
              </tr>
              <tr>
                <td>Median (P50)</td>
                <td>${medDuration}ms</td>
                <td>ℹ️</td>
              </tr>
              <tr>
                <td>P95 Response Time</td>
                <td>${p95Duration}ms</td>
                <td class="${parseFloat(p95Duration) < 500 ? 'metric-good' : parseFloat(p95Duration) < 1000 ? 'metric-warning' : 'metric-bad'}">
                  ${parseFloat(p95Duration) < 500 ? '✅' : parseFloat(p95Duration) < 1000 ? '⚠️' : '❌'}
                </td>
              </tr>
              <tr>
                <td>P99 Response Time</td>
                <td>${p99Duration}ms</td>
                <td class="${parseFloat(p99Duration) < 1000 ? 'metric-good' : 'metric-warning'}">
                  ${parseFloat(p99Duration) < 1000 ? '✅' : '⚠️'}
                </td>
              </tr>
              <tr>
                <td>Max Response Time</td>
                <td>${maxDuration}ms</td>
                <td>ℹ️</td>
              </tr>
              <tr>
                <td>Throughput</td>
                <td>${throughput} req/s</td>
                <td>✅</td>
              </tr>
              <tr>
                <td>Checks Passed</td>
                <td>${checksPass}/${checksPass + checksFail}</td>
                <td class="${checksFail === 0 ? 'metric-good' : 'metric-bad'}">${checksFail === 0 ? '✅' : '❌'}</td>
              </tr>
            </tbody>
          </table>`;

    // Add endpoint details if available
    if (testData.root_group?.groups) {
      html += `
          <h3 style="margin-top: 30px; color: #667eea;">Endpoint Details</h3>
          <table>
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Check</th>
                <th>Passed</th>
                <th>Failed</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>`;
      
      for (const group of testData.root_group.groups) {
        if (group.checks) {
          for (const check of group.checks) {
            html += `
              <tr>
                <td><strong>${group.name}</strong></td>
                <td>${check.name}</td>
                <td>${check.passes}</td>
                <td>${check.fails}</td>
                <td class="${check.fails === 0 ? 'metric-good' : 'metric-bad'}">${check.fails === 0 ? '✅' : '❌'}</td>
              </tr>`;
          }
        }
      }
      
      html += `
            </tbody>
          </table>`;
    }
    
    html += `
        </div>
      </div>`;
  }

  // Add recommendations
  if (reportData.recommendations && reportData.recommendations.length > 0) {
    html += `
      <div class="recommendations">
        <h3>💡 Recommendations</h3>`;
    
    for (const rec of reportData.recommendations) {
      const priorityClass = `priority-${rec.priority.toLowerCase()}`;
      html += `
        <div class="recommendation-item ${priorityClass}">
          <strong>${rec.priority}:</strong> ${rec.issue}<br>
          <em>→ ${rec.recommendation}</em>
        </div>`;
    }
    
    html += `
      </div>`;
  }

  html += `
    </div>
    
    <div class="footer">
      <p>Generated by K6 Performance Testing Framework</p>
      <p>Goodmen Logistics - Safety App Performance Report</p>
      <p style="margin-top: 10px; font-size: 0.85em;">
        For more details, check the JSON reports in the reports directory
      </p>
    </div>
  </div>
</body>
</html>`;

  return html;
}

function main() {
  console.log('📊 Generating HTML Performance Report...\n');
  
  const consolidatedPath = path.join(REPORTS_DIR, 'consolidated-report.json');
  
  if (!fs.existsSync(consolidatedPath)) {
    console.error('❌ No consolidated report found. Run tests first.');
    process.exit(1);
  }
  
  const reportData = JSON.parse(fs.readFileSync(consolidatedPath, 'utf-8'));
  const html = generateHTML(reportData);
  
  const outputPath = path.join(REPORTS_DIR, 'performance-report.html');
  fs.writeFileSync(outputPath, html);
  
  console.log('✅ HTML report generated successfully!');
  console.log(`📄 Location: ${outputPath}`);
  console.log('\n💡 Open the file in your browser to view the report');
}

main();
