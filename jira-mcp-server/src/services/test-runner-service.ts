import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface TestResult {
  framework: 'cypress' | 'karate' | 'k6';
  success: boolean;
  totalTests: number;
  passing: number;
  failing: number;
  duration: string;
  failures: TestFailure[];
  summary: string;
  rawOutput: string;
}

export interface TestFailure {
  testName: string;
  errorMessage: string;
  stackTrace?: string;
  file?: string;
  line?: number;
}

export class TestRunnerService {
  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  /**
   * Run Cypress tests for a specific spec
   */
  async runCypressTests(specPattern?: string, testName?: string): Promise<TestResult> {
    const cypressDir = path.join(this.workspacePath, 'goodmen-logistics/cypress-tests');
    
    try {
      let command = `cd "${cypressDir}" && npm run cypress:run`;
      
      if (specPattern) {
        command += ` -- --spec "${specPattern}"`;
      }
      
      if (testName) {
        // Use Cypress grep to run specific test by name
        command += ` --env grep="${testName}"`;
      }

      console.error('Running Cypress command:', command);
      
      const output = execSync(command, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        stdio: ['pipe', 'pipe', 'pipe']
      });

      return this.parseCypressResults(output);
    } catch (error: any) {
      // Cypress exits with non-zero code on test failures
      const output = error.stdout || error.stderr || error.message;
      return this.parseCypressResults(output);
    }
  }

  /**
   * Run Karate tests for a specific feature
   */
  async runKarateTests(tag?: string, scenarioName?: string): Promise<TestResult> {
    const karateDir = path.join(this.workspacePath, 'goodmen-logistics/karate-tests');
    
    try {
      let command = `cd "${karateDir}" && mvn test`;
      
      if (tag) {
        command = `cd "${karateDir}" && mvn test -Dkarate.options="--tags ${tag}"`;
      } else if (scenarioName) {
        // Use Karate's name filter to run specific scenario
        command = `cd "${karateDir}" && mvn test -Dkarate.options="--name ${scenarioName}"`;
      }

      console.error('Running Karate command:', command);
      
      const output = execSync(command, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      return this.parseKarateResults(output);
    } catch (error: any) {
      const output = error.stdout || error.stderr || error.message;
      return this.parseKarateResults(output);
    }
  }

  /**
   * Run K6 performance tests
   */
  async runK6Tests(scriptPath?: string): Promise<TestResult> {
    const k6Dir = path.join(this.workspacePath, 'k6-performance-tests');
    const defaultScript = 'tests/smoke.test.js';
    const script = scriptPath || defaultScript;
    
    try {
      const command = `cd "${k6Dir}" && k6 run "${script}"`;
      
      console.error('Running K6 command:', command);
      
      const output = execSync(command, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      return this.parseK6Results(output);
    } catch (error: any) {
      const output = error.stdout || error.stderr || error.message;
      return this.parseK6Results(output);
    }
  }

  /**
   * Parse Cypress test results
   */
  private parseCypressResults(output: string): TestResult {
    const failures: TestFailure[] = [];
    let totalTests = 0;
    let passing = 0;
    let failing = 0;
    let duration = '0s';

    // Extract test counts
    const testsMatch = output.match(/Tests:\s+(\d+)/);
    const passingMatch = output.match(/Passing:\s+(\d+)/);
    const failingMatch = output.match(/Failing:\s+(\d+)/);
    const durationMatch = output.match(/Duration:\s+([^│\n]+)/);

    if (testsMatch) totalTests = parseInt(testsMatch[1]);
    if (passingMatch) passing = parseInt(passingMatch[1]);
    if (failingMatch) failing = parseInt(failingMatch[1]);
    if (durationMatch) duration = durationMatch[1].trim();

    // Parse failures
    const failurePattern = /\d+\)\s+(.+?)\n\s+(.+?)(?=\n\n|\n\s+at\s+)/gs;
    let match;
    while ((match = failurePattern.exec(output)) !== null) {
      failures.push({
        testName: match[1].trim(),
        errorMessage: match[2].trim(),
      });
    }

    return {
      framework: 'cypress',
      success: failing === 0,
      totalTests,
      passing,
      failing,
      duration,
      failures,
      summary: `Cypress: ${passing}/${totalTests} passed, ${failing} failed`,
      rawOutput: output,
    };
  }

  /**
   * Parse Karate test results
   */
  private parseKarateResults(output: string): TestResult {
    const failures: TestFailure[] = [];
    let totalTests = 0;
    let passing = 0;
    let failing = 0;
    let duration = '0s';

    // Extract test counts from Maven output
    const testsMatch = output.match(/Tests run:\s+(\d+)/);
    const failuresMatch = output.match(/Failures:\s+(\d+)/);
    const errorsMatch = output.match(/Errors:\s+(\d+)/);
    const timeMatch = output.match(/Total time:\s+([^\n]+)/);

    if (testsMatch) totalTests = parseInt(testsMatch[1]);
    if (failuresMatch) failing += parseInt(failuresMatch[1]);
    if (errorsMatch) failing += parseInt(errorsMatch[1]);
    passing = totalTests - failing;
    if (timeMatch) duration = timeMatch[1].trim();

    // Parse Karate scenario failures
    const scenarioPattern = /\[ERROR\]\s+(.+?)\s*$/gm;
    let match;
    while ((match = scenarioPattern.exec(output)) !== null) {
      const errorMsg = match[1].trim();
      if (errorMsg.includes('»')) {
        failures.push({
          testName: errorMsg.split('»')[0].trim(),
          errorMessage: errorMsg,
        });
      }
    }

    return {
      framework: 'karate',
      success: failing === 0,
      totalTests,
      passing,
      failing,
      duration,
      failures,
      summary: `Karate: ${passing}/${totalTests} passed, ${failing} failed`,
      rawOutput: output,
    };
  }

  /**
   * Parse K6 test results
   */
  private parseK6Results(output: string): TestResult {
    const failures: TestFailure[] = [];
    let totalTests = 0;
    let passing = 0;
    let failing = 0;
    let duration = '0s';

    // Extract check statistics
    const checksMatch = output.match(/✓\s+(\d+)\s+\/\s+✗\s+(\d+)/);
    const durationMatch = output.match(/execution:\s+([^\n]+)/);

    if (checksMatch) {
      passing = parseInt(checksMatch[1]);
      failing = parseInt(checksMatch[2]);
      totalTests = passing + failing;
    }
    if (durationMatch) duration = durationMatch[1].trim();

    // Parse failed checks
    const failPattern = /✗\s+(.+?):\s+(.+?)$/gm;
    let match;
    while ((match = failPattern.exec(output)) !== null) {
      failures.push({
        testName: match[1].trim(),
        errorMessage: match[2].trim(),
      });
    }

    return {
      framework: 'k6',
      success: failing === 0,
      totalTests,
      passing,
      failing,
      duration,
      failures,
      summary: `K6: ${passing}/${totalTests} checks passed, ${failing} failed`,
      rawOutput: output,
    };
  }

  /**
   * Get available test specs
   */
  async getAvailableTests(): Promise<{
    cypress: string[];
    karate: string[];
    k6: string[];
  }> {
    const result = {
      cypress: [] as string[],
      karate: [] as string[],
      k6: [] as string[],
    };

    try {
      // Cypress specs
      const cypressDir = path.join(this.workspacePath, 'goodmen-logistics/cypress-tests/cypress/e2e');
      if (fs.existsSync(cypressDir)) {
        result.cypress = this.findFiles(cypressDir, '.cy.js');
      }

      // Karate features
      const karateDir = path.join(this.workspacePath, 'goodmen-logistics/karate-tests/src/test/java/com/goodmen/logistics/features');
      if (fs.existsSync(karateDir)) {
        result.karate = this.findFiles(karateDir, '.feature');
      }

      // K6 scripts
      const k6Dir = path.join(this.workspacePath, 'k6-performance-tests/tests');
      if (fs.existsSync(k6Dir)) {
        result.k6 = this.findFiles(k6Dir, '.test.js');
      }
    } catch (error) {
      console.error('Error getting available tests:', error);
    }

    return result;
  }

  /**
   * Get test cases from a specific test file
   */
  async getTestCases(testFile: string): Promise<{ framework: string; testCases: string[] }> {
    const testCases: string[] = [];
    let framework = 'unknown';

    try {
      // Determine framework based on file extension
      if (testFile.endsWith('.cy.js')) {
        framework = 'cypress';
        const filePath = path.join(this.workspacePath, 'goodmen-logistics/cypress-tests/cypress/e2e', testFile);
        const content = fs.readFileSync(filePath, 'utf-8');
        
        // Extract Cypress test names using regex for it() blocks
        const itRegex = /it\(['"](.+?)['"]/g;
        let match;
        while ((match = itRegex.exec(content)) !== null) {
          testCases.push(match[1]);
        }
      } else if (testFile.endsWith('.feature')) {
        framework = 'karate';
        const filePath = path.join(this.workspacePath, 'goodmen-logistics/karate-tests/src/test/java/com/goodmen/logistics/features', testFile);
        const content = fs.readFileSync(filePath, 'utf-8');
        
        // Extract Karate scenario names
        const scenarioRegex = /Scenario:\s*(.+)/g;
        let match;
        while ((match = scenarioRegex.exec(content)) !== null) {
          testCases.push(match[1].trim());
        }
      } else if (testFile.endsWith('.test.js')) {
        framework = 'k6';
        const filePath = path.join(this.workspacePath, 'k6-performance-tests/tests', testFile);
        const content = fs.readFileSync(filePath, 'utf-8');
        
        // K6 doesn't have individual test cases like Cypress/Karate
        // but we can extract check names
        const checkRegex = /check\([^,]+,\s*{[^}]*['"](.+?)['"]/g;
        let match;
        while ((match = checkRegex.exec(content)) !== null) {
          testCases.push(match[1]);
        }
      }
    } catch (error) {
      console.error('Error reading test file:', error);
    }

    return { framework, testCases };
  }

  /**
   * Helper to find files recursively
   */
  private findFiles(dir: string, extension: string): string[] {
    const files: string[] = [];
    
    const walk = (currentDir: string, baseDir: string) => {
      const items = fs.readdirSync(currentDir);
      
      for (const item of items) {
        const fullPath = path.join(currentDir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          walk(fullPath, baseDir);
        } else if (item.endsWith(extension)) {
          const relativePath = path.relative(baseDir, fullPath);
          files.push(relativePath);
        }
      }
    };

    walk(dir, dir);
    return files;
  }
}
