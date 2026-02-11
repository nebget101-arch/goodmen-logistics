/**
 * Generate consolidated performance test report
 * Combines all test results and formats for Confluence
 */

const fs = require('fs');
const path = require('path');
const reportsDir = path.join(__dirname, '../reports');
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

function loadReport(filename) {
  try {
    const filepath = path.join(REPORTS_DIR, filename);
    if (fs.existsSync(filepath)) {
      return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    }
  } catch (error) {
    console.error(`Error loading ${filename}:`, error.message);
  }
  return null;
}

function generateConsolidatedReport() {
  console.log('📊 Generating Consolidated Performance Report...\n');
  
  const reports = {
    smoke: loadReport('smoke-summary.json'),
    load: loadReport('load-summary.json'),
    stress: loadReport('stress-summary.json'),
    spike: loadReport('spike-summary.json'),
    soak: loadReport('soak-summary.json'),
  };
  
  const consolidatedReport = {
    generatedAt: new Date().toISOString(),
    testSuite: 'Goodmen Logistics Performance Tests',
    summary: {
      testsRun: Object.values(reports).filter(r => r !== null).length,
      overallStatus: determineOverallStatus(reports),
    },
    tests: reports,
    recommendations: generateRecommendations(reports),
  };
  
  // Save consolidated report
  const outputPath = path.join(REPORTS_DIR, 'consolidated-report.json');
  fs.writeFileSync(outputPath, JSON.stringify(consolidatedReport, null, 2));
  
  // Generate Confluence markdown
  const confluenceMarkdown = generateConfluenceMarkdown(consolidatedReport);
  const mdPath = path.join(REPORTS_DIR, 'confluence-report.md');
  fs.writeFileSync(mdPath, confluenceMarkdown);
  
  console.log('✅ Consolidated report generated:');
  console.log(`   📄 JSON: ${outputPath}`);
  console.log(`   📝 Markdown: ${mdPath}`);
  console.log('\n📊 Summary:');
  console.log(`   Tests Run: ${consolidatedReport.summary.testsRun}`);
  console.log(`   Overall Status: ${consolidatedReport.summary.overallStatus}`);
  
  return consolidatedReport;
}

function determineOverallStatus(reports) {
  let passCount = 0;
  let totalTests = 0;
  
  Object.values(reports).forEach(report => {
    if (report && report.thresholds) {
      totalTests++;
      const thresholdsPassed = Object.values(report.thresholds).every(t => t.ok);
      if (thresholdsPassed) passCount++;
    }
  });
  
  if (passCount === totalTests) return '✅ PASS';
  if (passCount === 0) return '❌ FAIL';
  return '⚠️  PARTIAL';
}

function generateRecommendations(reports) {
  const recommendations = [];
  
  // Check load test metrics
  if (reports.load && reports.load.metrics) {
    const metrics = reports.load.metrics;
    
    // Check error rate
    if (metrics.http_req_failed) {
      const errorRate = metrics.http_req_failed.value ? metrics.http_req_failed.value * 100 : 0;
      if (errorRate > 1) {
        recommendations.push({
          priority: 'HIGH',
          issue: `Error rate is ${errorRate.toFixed(2)}% (exceeds 1%)`,
          recommendation: 'Investigate and fix failing endpoints. Check database connections and API error handling.',
        });
      }
    }
    
    // Check P95 response time
    if (metrics.http_req_duration && metrics.http_req_duration['p(95)']) {
      const p95 = metrics.http_req_duration['p(95)'];
      if (p95 > 500) {
        recommendations.push({
          priority: 'MEDIUM',
          issue: `P95 response time is ${p95.toFixed(2)}ms (exceeds 500ms)`,
          recommendation: 'Optimize database queries, add caching, or scale infrastructure.',
        });
      }
    }
  }
  
  // Check smoke test for basic issues
  if (reports.smoke && reports.smoke.metrics) {
    const metrics = reports.smoke.metrics;
    if (metrics.http_req_failed && metrics.http_req_failed.passes > 0) {
      recommendations.push({
        priority: 'HIGH',
        issue: `Smoke test detected ${metrics.http_req_failed.passes} failed requests`,
        recommendation: 'Fix critical API errors before running further tests.',
      });
    }
  }
  
  // Check stress test for breaking point
  if (reports.stress && reports.stress.metrics) {
    const metrics = reports.stress.metrics;
    if (metrics.http_req_failed && metrics.http_req_failed.value > 0.1) {
      recommendations.push({
        priority: 'HIGH',
        issue: 'System failed under stress test',
        recommendation: 'Implement auto-scaling, increase server capacity, or optimize resource usage.',
      });
    }
  }
  
  if (recommendations.length === 0) {
    recommendations.push({
      priority: 'INFO',
      issue: 'No critical issues detected',
      recommendation: 'System performs well. Continue monitoring and regular performance testing.',
    });
  }
  
  return recommendations;
}

function formatMetricValue(value) {
  if (typeof value === 'number') {
    return value.toFixed(2);
  }
  if (typeof value === 'object' && value !== null) {
    if (value.avg !== undefined) return `${value.avg.toFixed(2)}ms`;
    if (value.count !== undefined) return value.count;
    if (value.rate !== undefined) return `${value.rate.toFixed(2)}/s`;
    if (value.value !== undefined) return value.value;
  }
  return String(value);
}

function generateConfluenceMarkdown(report) {
  let md = `# Performance Test Report - Goodmen Logistics

**Generated:** ${new Date(report.generatedAt).toLocaleString()}  
**Test Suite:** ${report.testSuite}  
**Overall Status:** ${report.summary.overallStatus}  

---

## 📊 Executive Summary

${report.summary.testsRun} performance tests were executed to evaluate system performance under various conditions.

### Test Results

`;

  // Add each test result
  Object.entries(report.tests).forEach(([testName, testData]) => {
    if (!testData) return;
    
    md += `#### ${testName.toUpperCase()} Test\n\n`;
    
    if (testData.metrics) {
      const metrics = testData.metrics;
      
      // Key performance metrics table
      md += `| Metric | Value |\n|--------|-------|\n`;
      
      // Total requests
      if (metrics.http_reqs) {
        md += `| Total Requests | ${metrics.http_reqs.count || 0} |\n`;
      }
      
      // Failed requests
      if (metrics.http_req_failed) {
        const failedCount = metrics.http_req_failed.passes || 0; // passes means failures in this metric
        md += `| Failed Requests | ${failedCount} |\n`;
        const errorRate = metrics.http_req_failed.value ? (metrics.http_req_failed.value * 100).toFixed(2) : '0.00';
        md += `| Error Rate | ${errorRate}% |\n`;
      }
      
      // Response times
      if (metrics.http_req_duration) {
        const dur = metrics.http_req_duration;
        md += `| Avg Response Time | ${dur.avg ? dur.avg.toFixed(2) + 'ms' : 'N/A'} |\n`;
        md += `| Min Response Time | ${dur.min ? dur.min.toFixed(2) + 'ms' : 'N/A'} |\n`;
        md += `| Max Response Time | ${dur.max ? dur.max.toFixed(2) + 'ms' : 'N/A'} |\n`;
        md += `| P50 (Median) | ${dur.med ? dur.med.toFixed(2) + 'ms' : 'N/A'} |\n`;
        md += `| P95 | ${dur['p(95)'] ? dur['p(95)'].toFixed(2) + 'ms' : 'N/A'} |\n`;
        md += `| P99 | ${dur['p(99)'] ? dur['p(99)'].toFixed(2) + 'ms' : 'N/A'} |\n`;
      }
      
      // Throughput
      if (metrics.http_reqs && metrics.http_reqs.rate) {
        md += `| Requests/sec | ${metrics.http_reqs.rate.toFixed(2)} |\n`;
      }
      
      // Checks
      if (metrics.checks) {
        md += `| Checks Passed | ${metrics.checks.passes || 0} |\n`;
        md += `| Checks Failed | ${metrics.checks.fails || 0} |\n`;
      }
      
      md += `\n`;
    }
  });

  md += `---

## 💡 Recommendations

`;

  report.recommendations.forEach((rec, index) => {
    md += `### ${index + 1}. ${rec.issue} (Priority: ${rec.priority})

**Recommendation:** ${rec.recommendation}

`;
  });

  md += `---

## 📈 Performance Metrics Details

`;

  // Add detailed metrics for each test type that ran
  if (report.tests.smoke && report.tests.smoke.metrics) {
    const metrics = report.tests.smoke.metrics;
    const failedRequests = metrics.http_req_failed?.passes || 0;
    md += `### Smoke Test Performance

- **Total Requests:** ${metrics.http_reqs?.count || 0}
- **Failed Requests:** ${failedRequests}
- **Error Rate:** ${metrics.http_req_failed?.value ? (metrics.http_req_failed.value * 100).toFixed(2) + '%' : '0%'}
- **Average Response Time:** ${metrics.http_req_duration?.avg ? metrics.http_req_duration.avg.toFixed(2) + 'ms' : 'N/A'}
- **P95 Response Time:** ${metrics.http_req_duration?.['p(95)'] ? metrics.http_req_duration['p(95)'].toFixed(2) + 'ms' : 'N/A'}
- **P99 Response Time:** ${metrics.http_req_duration?.['p(99)'] ? metrics.http_req_duration['p(99)'].toFixed(2) + 'ms' : 'N/A'}
- **Requests/sec:** ${metrics.http_reqs?.rate ? metrics.http_reqs.rate.toFixed(2) : 'N/A'}
- **Checks Passed:** ${metrics.checks?.passes || 0}/${(metrics.checks?.passes || 0) + (metrics.checks?.fails || 0)}

`;
  }

  if (report.tests.load && report.tests.load.metrics) {
    const metrics = report.tests.load.metrics;
    const failedRequests = metrics.http_req_failed?.passes || 0;
    md += `### Load Test Performance

- **Total Requests:** ${metrics.http_reqs?.count || 0}
- **Failed Requests:** ${failedRequests}
- **Error Rate:** ${metrics.http_req_failed?.value ? (metrics.http_req_failed.value * 100).toFixed(2) + '%' : '0%'}
- **Average Response Time:** ${metrics.http_req_duration?.avg ? metrics.http_req_duration.avg.toFixed(2) + 'ms' : 'N/A'}
- **P95 Response Time:** ${metrics.http_req_duration?.['p(95)'] ? metrics.http_req_duration['p(95)'].toFixed(2) + 'ms' : 'N/A'}
- **P99 Response Time:** ${metrics.http_req_duration?.['p(99)'] ? metrics.http_req_duration['p(99)'].toFixed(2) + 'ms' : 'N/A'}
- **Requests/sec:** ${metrics.http_reqs?.rate ? metrics.http_reqs.rate.toFixed(2) : 'N/A'}

`;
  }

  md += `---

## 🎯 Next Steps

1. **Review Recommendations:** Address high-priority issues first
2. **Monitor Production:** Continue monitoring these metrics in production
3. **Optimize:** Implement recommended optimizations
4. **Re-test:** Run performance tests after optimizations
5. **Document:** Update capacity planning based on results

---

*Report generated automatically by K6 Performance Testing Framework*
`;

  return md;
}

// Run if called directly
if (require.main === module) {
  generateConsolidatedReport();
}

module.exports = { generateConsolidatedReport };
