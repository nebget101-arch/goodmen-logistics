/**
 * Generate Confluence-Compatible HTML Performance Report
 * 
 * Creates a simplified HTML report optimized for Confluence,
 * using only inline styles that Confluence supports.
 * 
 * Usage:
 *   node scripts/generate-confluence-html.js
 */

const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');

function generateConfluenceHTML(reportData) {
  const timestamp = new Date(reportData.generatedAt).toLocaleString();
  const testsRun = reportData.summary.testsRun;
  const overallStatus = reportData.summary.overallStatus;
  
  // Get available tests
  const availableTests = Object.entries(reportData.tests)
    .filter(([_, data]) => data !== null)
    .map(([name, _]) => name);

  // Simple inline styles that Confluence supports
  const styles = {
    headerBg: '#667eea',
    successGreen: '#10b981',
    errorRed: '#ef4444',
    warningOrange: '#f59e0b',
    infoBlue: '#3b82f6',
    lightGray: '#f9fafb',
    borderGray: '#e5e7eb',
  };

  let html = `<div style="background-color: ${styles.headerBg}; color: white; padding: 30px; text-align: center; margin-bottom: 20px;">
  <h1 style="color: white; margin: 0 0 10px 0;">🚀 Performance Test Report</h1>
  <p style="margin: 5px 0; font-size: 1.1em;">Goodmen Logistics Safety App</p>
  <p style="margin: 5px 0; opacity: 0.9;">Generated: ${timestamp}</p>
  `;

  // Overall status badge
  let statusColor = overallStatus === 'PASS' ? styles.successGreen : 
                    overallStatus === 'FAIL' ? styles.errorRed : styles.warningOrange;
  let statusIcon = overallStatus === 'PASS' ? '✓' : 
                   overallStatus === 'FAIL' ? '✗' : '⚠';
  
  html += `<div style="display: inline-block; background-color: ${statusColor}; color: white; padding: 10px 25px; border-radius: 5px; font-weight: bold; margin-top: 15px;">${statusIcon} ${overallStatus}</div>
</div>`;

  // Summary section
  html += `<div style="background-color: ${styles.lightGray}; padding: 20px; margin-bottom: 20px;">
  <h2 style="margin: 0 0 20px 0; color: #333;">Summary</h2>
  <table border="1" cellpadding="10" cellspacing="0" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="background-color: white; border: 1px solid ${styles.borderGray}; padding: 15px;">
        <strong style="color: ${styles.headerBg};">TESTS EXECUTED</strong><br/>
        <span style="font-size: 2em; font-weight: bold;">${testsRun}</span>
      </td>
      <td style="background-color: white; border: 1px solid ${styles.borderGray}; padding: 15px;">
        <strong style="color: ${styles.headerBg};">TEST TYPES</strong><br/>
        <span style="font-size: 2em; font-weight: bold;">${availableTests.join(', ').toUpperCase()}</span>
      </td>
      <td style="background-color: white; border: 1px solid ${styles.borderGray}; padding: 15px;">
        <strong style="color: ${styles.headerBg};">OVERALL STATUS</strong><br/>
        <span style="font-size: 2em; font-weight: bold; color: ${statusColor};">${statusIcon} ${overallStatus}</span>
      </td>
    </tr>
  </table>
</div>`;

  // Individual test results
  availableTests.forEach(testType => {
    const testData = reportData.tests[testType];
    if (!testData) return;

    const metrics = testData.metrics || {};
    const totalRequests = metrics.http_reqs?.values?.count || 0;
    const failedRequests = metrics.http_req_failed?.values?.passes || 0;
    const errorRate = metrics.http_req_failed?.values?.rate ? (metrics.http_req_failed.values.rate * 100).toFixed(2) : '0.00';
    const avgDuration = metrics.http_req_duration?.values?.avg?.toFixed(2) || 'N/A';
    const p95Duration = metrics.http_req_duration?.values?.['p(95)']?.toFixed(2) || 'N/A';
    const p99Duration = metrics.http_req_duration?.values?.['p(99)']?.toFixed(2) || 'N/A';
    const minDuration = metrics.http_req_duration?.values?.min?.toFixed(2) || 'N/A';
    const maxDuration = metrics.http_req_duration?.values?.max?.toFixed(2) || 'N/A';
    const medDuration = metrics.http_req_duration?.values?.med?.toFixed(2) || 'N/A';
    const checksPass = metrics.checks?.values?.passes || 0;
    const checksFail = metrics.checks?.values?.fails || 0;
    const throughput = metrics.http_reqs?.values?.rate?.toFixed(2) || 'N/A';
    const duration = testData.state?.testRunDurationMs ? (testData.state.testRunDurationMs / 1000).toFixed(1) : 'N/A';
    
    const testStatus = failedRequests === 0 && checksFail === 0 ? 'PASS' : 'FAIL';
    const testStatusColor = testStatus === 'PASS' ? styles.successGreen : styles.errorRed;
    const testStatusIcon = testStatus === 'PASS' ? '✓' : '✗';

    const requestSuccessRate = totalRequests > 0 ? (((totalRequests - failedRequests) / totalRequests) * 100).toFixed(2) : '100.00';
    const checkSuccessRate = (checksPass + checksFail) > 0 ? ((checksPass / (checksPass + checksFail)) * 100).toFixed(2) : '100.00';

    html += `<div style="margin-bottom: 30px; border: 2px solid ${styles.borderGray}; padding: 20px;">
  <h2 style="margin: 0 0 20px 0; color: #333; border-bottom: 3px solid ${styles.headerBg}; padding-bottom: 10px;">${testType.toUpperCase()} Test Results</h2>
  
  <div style="margin-bottom: 20px;">
    <strong>Request Success Rate</strong>
    <div style="background-color: ${styles.borderGray}; height: 25px; border-radius: 5px; overflow: hidden; margin-top: 5px;">
      <div style="background-color: ${styles.successGreen}; width: ${requestSuccessRate}%; height: 100%; text-align: center; color: white; font-weight: bold; line-height: 25px;">${requestSuccessRate}%</div>
    </div>
  </div>
  
  <div style="margin-bottom: 20px;">
    <strong>Check Success Rate</strong>
    <div style="background-color: ${styles.borderGray}; height: 25px; border-radius: 5px; overflow: hidden; margin-top: 5px;">
      <div style="background-color: ${styles.successGreen}; width: ${checkSuccessRate}%; height: 100%; text-align: center; color: white; font-weight: bold; line-height: 25px;">${checkSuccessRate}%</div>
    </div>
  </div>
  
  <table border="1" cellpadding="10" cellspacing="0" style="width: 100%; border-collapse: collapse; margin-top: 20px;">
    <tr>
      <th style="background-color: ${styles.headerBg}; color: white; padding: 12px; text-align: left;">Metric</th>
      <th style="background-color: ${styles.headerBg}; color: white; padding: 12px; text-align: left;">Value</th>
      <th style="background-color: ${styles.headerBg}; color: white; padding: 12px; text-align: left;">Status</th>
    </tr>
    ${generateMetricRow('Test Duration', `${duration}s`, 'ℹ', styles.infoBlue)}
    ${generateMetricRow('Total Requests', totalRequests, failedRequests === 0 ? '✓' : '✗', failedRequests === 0 ? styles.successGreen : styles.errorRed)}
    ${generateMetricRow('Failed Requests', failedRequests, failedRequests === 0 ? '✓' : '✗', failedRequests === 0 ? styles.successGreen : styles.errorRed)}
    ${generateMetricRow('Error Rate', `${errorRate}%`, parseFloat(errorRate) === 0 ? '✓' : '✗', parseFloat(errorRate) === 0 ? styles.successGreen : styles.errorRed)}
    ${generateMetricRow('Avg Response Time', `${avgDuration}ms`, parseFloat(avgDuration) < 200 ? '✓' : '⚠', parseFloat(avgDuration) < 200 ? styles.successGreen : styles.warningOrange)}
    ${generateMetricRow('Min Response Time', `${minDuration}ms`, 'ℹ', styles.infoBlue)}
    ${generateMetricRow('Median (P50)', `${medDuration}ms`, 'ℹ', styles.infoBlue)}
    ${generateMetricRow('P95 Response Time', `${p95Duration}ms`, parseFloat(p95Duration) < 500 ? '✓' : '✗', parseFloat(p95Duration) < 500 ? styles.successGreen : styles.errorRed)}
    ${generateMetricRow('P99 Response Time', `${p99Duration}ms`, p99Duration !== 'N/A' ? '⚠' : 'ℹ', p99Duration !== 'N/A' ? styles.warningOrange : styles.infoBlue)}
    ${generateMetricRow('Max Response Time', `${maxDuration}ms`, 'ℹ', styles.infoBlue)}
    ${generateMetricRow('Throughput', `${throughput} req/s`, 'ℹ', styles.infoBlue)}
    ${generateMetricRow('Checks Passed', `${checksPass}/${checksPass + checksFail}`, checksFail === 0 ? '✓' : '✗', checksFail === 0 ? styles.successGreen : styles.errorRed)}
  </table>
</div>`;
  });

  // Recommendations
  const recommendations = reportData.recommendations || [];
  if (recommendations.length > 0) {
    html += `<div style="background-color: #fef3c7; border-left: 4px solid ${styles.warningOrange}; padding: 20px; margin-top: 30px;">
  <h2 style="margin: 0 0 15px 0; color: #92400e;">⚠ Recommendations</h2>
  <ul style="margin: 0; padding-left: 20px;">`;
    
    recommendations.forEach(rec => {
      const priority = rec.priority || 'INFO';
      const message = rec.message || rec.description || rec.text || 'No details available';
      html += `    <li style="margin-bottom: 10px; color: #78350f;"><strong>${priority}:</strong> ${message}</li>\n`;
    });
    
    html += `  </ul>
</div>`;
  }

  return html;
}

function generateMetricRow(metric, value, icon, color) {
  return `    <tr>
      <td style="padding: 12px; border: 1px solid #e5e7eb;">${metric}</td>
      <td style="padding: 12px; border: 1px solid #e5e7eb;"><strong>${value}</strong></td>
      <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: center;"><span style="color: ${color}; font-weight: bold;">${icon}</span></td>
    </tr>`;
}

// Main execution
try {
  const consolidatedPath = path.join(REPORTS_DIR, 'consolidated-report.json');
  
  if (!fs.existsSync(consolidatedPath)) {
    console.error('❌ No test results found. Run tests first.');
    process.exit(1);
  }

  const reportData = JSON.parse(fs.readFileSync(consolidatedPath, 'utf-8'));
  const html = generateConfluenceHTML(reportData);
  
  const outputPath = path.join(REPORTS_DIR, 'confluence-report.html');
  fs.writeFileSync(outputPath, html);
  
  console.log('✅ Confluence HTML report generated successfully!');
  console.log(`📄 Report: ${outputPath}`);
} catch (error) {
  console.error('❌ Error generating Confluence HTML:', error.message);
  process.exit(1);
}
