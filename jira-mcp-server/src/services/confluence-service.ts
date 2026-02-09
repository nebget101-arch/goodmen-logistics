import axios, { AxiosInstance } from 'axios';

export interface ConfluenceConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  spaceKey: string;
}

export interface TestReportData {
  title: string;
  framework: string;
  timestamp: string;
  success: boolean;
  totalTests: number;
  passing: number;
  failing: number;
  duration: string;
  failures: Array<{
    testName: string;
    errorMessage: string;
  }>;
  summary: string;
  jiraBugs?: string[]; // Array of created JIRA issue keys
}

export class ConfluenceService {
  private client: AxiosInstance;
  private spaceKey: string;

  constructor(config: ConfluenceConfig) {
    this.spaceKey = config.spaceKey;

    // Validate configuration
    if (!config.baseUrl) {
      throw new Error('CONFLUENCE_BASE_URL is not configured');
    }
    if (!config.email) {
      throw new Error('CONFLUENCE_EMAIL is not configured');
    }
    if (!config.apiToken) {
      throw new Error('CONFLUENCE_API_TOKEN is not configured');
    }
    if (!config.spaceKey) {
      throw new Error('CONFLUENCE_SPACE_KEY is not configured');
    }

    // Create Confluence REST API client
    this.client = axios.create({
      baseURL: `${config.baseUrl}/wiki/rest/api`,
      headers: {
        'Content-Type': 'application/json',
      },
      auth: {
        username: config.email,
        password: config.apiToken,
      },
    });
  }

  /**
   * Create test execution report in Confluence
   */
  async createTestReport(data: TestReportData, parentPageId?: string): Promise<{ id: string; url: string }> {
    const content = this.formatTestReportContent(data);
    const title = `${data.title} - ${data.timestamp}`;

    try {
      const body: any = {
        type: 'page',
        title,
        space: {
          key: this.spaceKey,
        },
        body: {
          storage: {
            value: content,
            representation: 'storage',
          },
        },
      };

      if (parentPageId) {
        body.ancestors = [{ id: parentPageId }];
      }

      const response = await this.client.post('/content', body);

      const baseUrl = this.client.defaults.baseURL || '';
      const pageUrl = `${baseUrl.replace('/wiki/rest/api', '')}/wiki/spaces/${this.spaceKey}/pages/${response.data.id}`;

      return {
        id: response.data.id,
        url: pageUrl,
      };
    } catch (error: any) {
      console.error('Confluence API error:', error.response?.status, error.response?.data);
      throw new Error(`Failed to create Confluence page: ${error.message}`);
    }
  }

  /**
   * Format test report data into Confluence storage format
   */
  private formatTestReportContent(data: TestReportData): string {
    const statusMacro = data.success
      ? '<ac:structured-macro ac:name="status"><ac:parameter ac:name="color">Green</ac:parameter><ac:parameter ac:name="title">PASSED</ac:parameter></ac:structured-macro>'
      : '<ac:structured-macro ac:name="status"><ac:parameter ac:name="color">Red</ac:parameter><ac:parameter ac:name="title">FAILED</ac:parameter></ac:structured-macro>';

    let html = `
<h2>Test Execution Summary</h2>
<p><strong>Status:</strong> ${statusMacro}</p>
<p><strong>Framework:</strong> ${data.framework.toUpperCase()}</p>
<p><strong>Execution Time:</strong> ${data.timestamp}</p>
<p><strong>Duration:</strong> ${data.duration}</p>

<h3>Test Results</h3>
<table>
  <tbody>
    <tr>
      <th>Total Tests</th>
      <td>${data.totalTests}</td>
    </tr>
    <tr>
      <th>Passing</th>
      <td><ac:structured-macro ac:name="status"><ac:parameter ac:name="color">Green</ac:parameter><ac:parameter ac:name="title">${data.passing}</ac:parameter></ac:structured-macro></td>
    </tr>
    <tr>
      <th>Failing</th>
      <td><ac:structured-macro ac:name="status"><ac:parameter ac:name="color">Red</ac:parameter><ac:parameter ac:name="title">${data.failing}</ac:parameter></ac:structured-macro></td>
    </tr>
    <tr>
      <th>Success Rate</th>
      <td>${data.totalTests > 0 ? ((data.passing / data.totalTests) * 100).toFixed(1) : 0}%</td>
    </tr>
  </tbody>
</table>
`;

    // Add failures section if there are any
    if (data.failures && data.failures.length > 0) {
      html += `
<h3>Test Failures</h3>
<ac:structured-macro ac:name="expand">
  <ac:parameter ac:name="title">View ${data.failures.length} Failed Test(s)</ac:parameter>
  <ac:rich-text-body>
    <table>
      <tbody>
        <tr>
          <th>Test Name</th>
          <th>Error Message</th>
        </tr>
`;

      for (const failure of data.failures) {
        html += `
        <tr>
          <td><code>${this.escapeHtml(failure.testName)}</code></td>
          <td><code>${this.escapeHtml(failure.errorMessage)}</code></td>
        </tr>
`;
      }

      html += `
      </tbody>
    </table>
  </ac:rich-text-body>
</ac:structured-macro>
`;
    }

    // Add JIRA bugs section if any were created
    if (data.jiraBugs && data.jiraBugs.length > 0) {
      html += `
<h3>Created JIRA Bugs</h3>
<p>The following bugs were automatically created for test failures:</p>
<ul>
`;

      for (const issueKey of data.jiraBugs) {
        html += `  <li><ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">${issueKey}</ac:parameter></ac:structured-macro></li>\n`;
      }

      html += `</ul>\n`;
    }

    // Add summary
    html += `
<h3>Summary</h3>
<p>${data.summary}</p>

<ac:structured-macro ac:name="info">
  <ac:rich-text-body>
    <p>This report was automatically generated by the Test Automation MCP Server</p>
  </ac:rich-text-body>
</ac:structured-macro>
`;

    return html;
  }

  /**
   * Find page by title
   */
  async findPageByTitle(title: string): Promise<string | null> {
    try {
      const response = await this.client.get('/content', {
        params: {
          spaceKey: this.spaceKey,
          title,
          type: 'page',
        },
      });

      if (response.data.results && response.data.results.length > 0) {
        return response.data.results[0].id;
      }

      return null;
    } catch (error) {
      console.error('Error finding page:', error);
      return null;
    }
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
