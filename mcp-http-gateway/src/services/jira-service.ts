import axios, { AxiosInstance } from "axios";

export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
}

export interface CreateIssueParams {
  summary: string;
  description: string;
  issueType: "Story" | "Epic" | "Bug" | "Task";
  priority?: "Highest" | "High" | "Medium" | "Low" | "Lowest";
  labels?: string[];
  epicLink?: string;
  parentKey?: string;
  components?: string[];
  storyPoints?: number;
  acceptanceCriteria?: string[];
}

export interface JiraIssue {
  key: string;
  id: string;
  self: string;
  fields: any;
}

export class JiraService {
  private client: AxiosInstance;
  private projectKey: string;

  constructor(config: JiraConfig) {
    this.projectKey = config.projectKey;

    if (!config.baseUrl) {
      throw new Error("JIRA_BASE_URL is not configured");
    }
    if (!config.email) {
      throw new Error("JIRA_EMAIL is not configured");
    }
    if (!config.apiToken) {
      throw new Error("JIRA_API_TOKEN is not configured");
    }
    if (!config.projectKey) {
      throw new Error("JIRA_PROJECT_KEY is not configured");
    }

    this.client = axios.create({
      baseURL: `${config.baseUrl}/rest/api/3`,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      auth: {
        username: config.email,
        password: config.apiToken,
      },
    });
  }

  /**
   * Create a Jira issue (Story, Epic, Bug, Task)
   */
  async createIssue(params: CreateIssueParams): Promise<JiraIssue> {
    try {
      // Build description with acceptance criteria
      let fullDescription = params.description;
      
      if (params.acceptanceCriteria && params.acceptanceCriteria.length > 0) {
        fullDescription += "\n\n*Acceptance Criteria:*\n";
        params.acceptanceCriteria.forEach((criteria, index) => {
          fullDescription += `${index + 1}. ${criteria}\n`;
        });
      }

      const issueData: any = {
        fields: {
          project: {
            key: this.projectKey,
          },
          summary: params.summary,
          description: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: fullDescription,
                  },
                ],
              },
            ],
          },
          issuetype: {
            name: params.issueType,
          },
        },
      };

      // Add priority
      if (params.priority) {
        issueData.fields.priority = { name: params.priority };
      }

      // Add labels
      if (params.labels && params.labels.length > 0) {
        issueData.fields.labels = params.labels;
      }

      // Add components
      if (params.components && params.components.length > 0) {
        issueData.fields.components = params.components.map((name) => ({ name }));
      }

      // Add parent for subtasks
      if (params.parentKey) {
        issueData.fields.parent = { key: params.parentKey };
      }

      // Add story points (if custom field exists)
      if (params.storyPoints !== undefined) {
        // This field ID may vary - adjust based on your Jira configuration
        issueData.fields.customfield_10016 = params.storyPoints;
      }

      const response = await this.client.post("/issue", issueData);

      console.error(`✅ Created ${params.issueType}: ${response.data.key}`);

      return response.data;
    } catch (error: any) {
      console.error("=== Jira Error ===");
      console.error("Status:", error.response?.status);
      console.error("Error Data:", JSON.stringify(error.response?.data, null, 2));
      throw new Error(
        `Failed to create Jira issue: ${error.response?.data?.errorMessages?.join(", ") || error.message}`
      );
    }
  }

  /**
   * Link two Jira issues
   */
  async linkIssues(
    inwardIssue: string,
    outwardIssue: string,
    linkType: "Relates" | "Blocks" | "Clones" | "Duplicate"
  ): Promise<void> {
    try {
      await this.client.post("/issueLink", {
        type: {
          name: linkType,
        },
        inwardIssue: {
          key: inwardIssue,
        },
        outwardIssue: {
          key: outwardIssue,
        },
      });

      console.error(`✅ Linked ${inwardIssue} to ${outwardIssue} (${linkType})`);
    } catch (error: any) {
      console.error("Failed to link issues:", error.response?.data);
      throw new Error(`Failed to link issues: ${error.message}`);
    }
  }

  /**
   * Search for existing issues
   */
  async searchIssues(jql: string, maxResults: number = 50): Promise<JiraIssue[]> {
    try {
      const response = await this.client.post("/search", {
        jql,
        maxResults,
        fields: ["summary", "status", "assignee", "created"],
      });

      return response.data.issues;
    } catch (error: any) {
      console.error("Failed to search issues:", error.response?.data);
      throw new Error(`Failed to search issues: ${error.message}`);
    }
  }

  /**
   * Get issue details
   */
  async getIssue(issueKey: string): Promise<JiraIssue> {
    try {
      const response = await this.client.get(`/issue/${issueKey}`);
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get issue: ${error.message}`);
    }
  }

  /**
   * Add comment to issue
   */
  async addComment(issueKey: string, comment: string): Promise<void> {
    try {
      await this.client.post(`/issue/${issueKey}/comment`, {
        body: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: comment,
                },
              ],
            },
          ],
        },
      });

      console.error(`✅ Added comment to ${issueKey}`);
    } catch (error: any) {
      throw new Error(`Failed to add comment: ${error.message}`);
    }
  }
}
