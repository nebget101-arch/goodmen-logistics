import * as fs from "fs";
import * as path from "path";

export interface TestFailure {
  testName: string;
  errorMessage: string;
  stackTrace?: string;
  testFile?: string;
}

export interface BugAnalysis {
  isActualBug: boolean;
  confidence: "High" | "Medium" | "Low";
  bugType: "Code Defect" | "Test Issue" | "Environment Issue" | "Configuration Issue" | "Unknown";
  rootCause: string;
  affectedComponents: string[];
  severity: "Critical" | "High" | "Medium" | "Low";
  reproducible: boolean;
}

export class TestAnalysisService {
  private testResultsPath: string;

  constructor(testResultsPath: string) {
    this.testResultsPath = testResultsPath;
  }

  /**
   * Analyze test failure to determine if it's an actual bug
   */
  analyzeTestFailure(failure: TestFailure): BugAnalysis {
    const errorMsg = failure.errorMessage.toLowerCase();
    const testName = failure.testName.toLowerCase();

    // Analyze patterns to determine if it's a real bug
    const patterns = {
      // Actual bugs
      nullPointer: /null|undefined|cannot read property/,
      typeError: /type error|expected .* but got/,
      assertionError: /assertion failed|expected .* to (be|equal)/,
      statusCodeError: /status code (4\d\d|5\d\d)/,
      
      // Not bugs (test/env issues)
      timeout: /timeout|timed out/,
      networkError: /network|econnrefused|fetch failed/,
      testSetup: /before hook|after hook|setup|teardown/,
      flaky: /intermittent|sometimes|occasionally/,
    };

    let isActualBug = true;
    let confidence: "High" | "Medium" | "Low" = "Medium";
    let bugType: BugAnalysis["bugType"] = "Unknown";
    let severity: BugAnalysis["severity"] = "Medium";
    let reproducible = true;

    // Check for test/environment issues (not bugs)
    if (patterns.timeout.test(errorMsg)) {
      isActualBug = false;
      bugType = "Environment Issue";
      confidence = "High";
      severity = "Low";
      reproducible = false;
    } else if (patterns.networkError.test(errorMsg)) {
      isActualBug = false;
      bugType = "Environment Issue";
      confidence = "High";
    } else if (patterns.testSetup.test(errorMsg)) {
      isActualBug = false;
      bugType = "Test Issue";
      confidence = "High";
    } else if (patterns.flaky.test(errorMsg) || patterns.flaky.test(testName)) {
      isActualBug = true;
      bugType = "Code Defect";
      confidence = "Low";
      severity = "Medium";
      reproducible = false;
    }
    // Check for actual code defects
    else if (patterns.nullPointer.test(errorMsg)) {
      isActualBug = true;
      bugType = "Code Defect";
      confidence = "High";
      severity = "High";
    } else if (patterns.typeError.test(errorMsg)) {
      isActualBug = true;
      bugType = "Code Defect";
      confidence = "High";
      severity = "High";
    } else if (patterns.assertionError.test(errorMsg)) {
      isActualBug = true;
      bugType = "Code Defect";
      confidence = "Medium";
      severity = "Medium";
    } else if (patterns.statusCodeError.test(errorMsg)) {
      isActualBug = true;
      bugType = "Code Defect";
      confidence = "High";
      
      // 5xx errors are more severe than 4xx
      if (/status code 5\d\d/.test(errorMsg)) {
        severity = "Critical";
      } else {
        severity = "High";
      }
    }

    // Identify affected components from test name/file
    const affectedComponents = this.identifyComponents(failure);

    // Generate root cause analysis
    const rootCause = this.generateRootCause(failure, bugType);

    return {
      isActualBug,
      confidence,
      bugType,
      rootCause,
      affectedComponents,
      severity,
      reproducible,
    };
  }

  /**
   * Read test results from file system
   */
  async getTestFailures(): Promise<TestFailure[]> {
    const failures: TestFailure[] = [];

    try {
      // Try to read K6 consolidated report
      const k6ReportPath = path.join(this.testResultsPath, "consolidated-report.json");
      if (fs.existsSync(k6ReportPath)) {
        const reportData = JSON.parse(fs.readFileSync(k6ReportPath, "utf-8"));
        
        // Extract failures from K6 report
        for (const [testType, testData] of Object.entries(reportData.tests || {})) {
          if (!testData) continue;
          
          const data = testData as any;
          const metrics = data.metrics || {};
          
          // Check for failed requests
          const failedRequests = metrics.http_req_failed?.values?.passes || 0;
          if (failedRequests > 0) {
            failures.push({
              testName: `${testType} - HTTP Request Failures`,
              errorMessage: `${failedRequests} requests failed during ${testType} test`,
              testFile: `tests/${testType}.test.js`,
            });
          }
          
          // Check for failed checks
          const failedChecks = metrics.checks?.values?.fails || 0;
          if (failedChecks > 0) {
            failures.push({
              testName: `${testType} - Check Failures`,
              errorMessage: `${failedChecks} checks failed during ${testType} test`,
              testFile: `tests/${testType}.test.js`,
            });
          }
        }
      }
    } catch (error) {
      console.error("Error reading test results:", error);
    }

    return failures;
  }

  /**
   * Identify affected components from test failure
   */
  private identifyComponents(failure: TestFailure): string[] {
    const components: string[] = [];
    const text = `${failure.testName} ${failure.errorMessage} ${failure.testFile || ""}`.toLowerCase();

    const componentMap: { [key: string]: string } = {
      driver: "Drivers",
      vehicle: "Vehicles",
      hos: "Hours of Service",
      load: "Loads",
      audit: "Audit",
      dashboard: "Dashboard",
      maintenance: "Maintenance",
      api: "API",
      database: "Database",
      auth: "Authentication",
    };

    for (const [keyword, component] of Object.entries(componentMap)) {
      if (text.includes(keyword)) {
        components.push(component);
      }
    }

    return components.length > 0 ? components : ["Unknown"];
  }

  /**
   * Generate root cause description
   */
  private generateRootCause(failure: TestFailure, bugType: BugAnalysis["bugType"]): string {
    switch (bugType) {
      case "Code Defect":
        return `Code defect detected in test '${failure.testName}'. Error: ${failure.errorMessage}. This appears to be a genuine bug in the application code that needs to be fixed.`;
      
      case "Test Issue":
        return `Test infrastructure issue in '${failure.testName}'. Error: ${failure.errorMessage}. The test itself needs to be fixed or updated, not the application code.`;
      
      case "Environment Issue":
        return `Environment or infrastructure issue affecting '${failure.testName}'. Error: ${failure.errorMessage}. This is likely a temporary issue with test environment, network, or external dependencies.`;
      
      case "Configuration Issue":
        return `Configuration problem detected in '${failure.testName}'. Error: ${failure.errorMessage}. Review configuration settings and environment variables.`;
      
      default:
        return `Test failure in '${failure.testName}' requires investigation. Error: ${failure.errorMessage}. Further analysis needed to determine root cause.`;
    }
  }

  /**
   * Generate bug report with detailed analysis
   */
  generateBugReport(failure: TestFailure, analysis: BugAnalysis): string {
    let report = `*Test Failure Analysis*\n\n`;
    report += `*Test:* ${failure.testName}\n`;
    report += `*Error:* ${failure.errorMessage}\n\n`;
    
    if (failure.testFile) {
      report += `*Test File:* ${failure.testFile}\n\n`;
    }
    
    report += `*Analysis:*\n`;
    report += `- Bug Type: ${analysis.bugType}\n`;
    report += `- Confidence: ${analysis.confidence}\n`;
    report += `- Severity: ${analysis.severity}\n`;
    report += `- Reproducible: ${analysis.reproducible ? "Yes" : "No (Flaky)"}\n`;
    report += `- Affected Components: ${analysis.affectedComponents.join(", ")}\n\n`;
    
    report += `*Root Cause:*\n${analysis.rootCause}\n\n`;
    
    if (failure.stackTrace) {
      report += `*Stack Trace:*\n{code}\n${failure.stackTrace}\n{code}\n\n`;
    }
    
    report += `*Steps to Reproduce:*\n`;
    report += `1. Run the test: ${failure.testName}\n`;
    report += `2. Observe the failure\n\n`;
    
    report += `*Expected Behavior:*\nTest should pass without errors\n\n`;
    report += `*Actual Behavior:*\n${failure.errorMessage}`;
    
    return report;
  }
}
