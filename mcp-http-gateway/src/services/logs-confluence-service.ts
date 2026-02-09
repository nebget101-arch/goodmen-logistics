import axios, { AxiosInstance } from "axios";

export interface ConfluenceConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  spaceKey: string;
}

export interface PostLogsParams {
  pageTitle: string;
  logs: string;
  pageId?: string;
  parentPageId?: string;
}

export class ConfluenceService {
  private client: AxiosInstance;
  private spaceKey: string;

  constructor(config: ConfluenceConfig) {
    this.spaceKey = config.spaceKey;

    // Validate configuration
    if (!config.baseUrl) {
      throw new Error("CONFLUENCE_BASE_URL is not configured in .env file");
    }
    if (!config.email) {
      throw new Error("CONFLUENCE_EMAIL is not configured in .env file");
    }
    if (!config.apiToken) {
      throw new Error("CONFLUENCE_API_TOKEN is not configured in .env file");
    }
    if (!config.spaceKey) {
      throw new Error("CONFLUENCE_SPACE_KEY is not configured in .env file");
    }

    // Create Confluence REST API client
    this.client = axios.create({
      baseURL: `${config.baseUrl}/wiki/rest/api`,
      headers: {
        "Content-Type": "application/json",
      },
      auth: {
        username: config.email,
        password: config.apiToken,
      },
    });
  }

  /**
   * Post logs to Confluence (create new page or update existing)
   */
  async postLogs(params: PostLogsParams): Promise<{ id: string; url: string }> {
    const { pageTitle, logs, pageId, parentPageId } = params;

    console.error("=== postLogs called ===");
    console.error("pageTitle:", pageTitle);
    console.error("pageId:", pageId);
    console.error("parentPageId:", parentPageId);
    console.error("spaceKey:", this.spaceKey);
    console.error("baseURL:", this.client.defaults.baseURL);

    // Convert logs to Confluence storage format (HTML-like)
    const content = this.formatLogsForConfluence(logs);
    console.error("Formatted content length:", content.length);

    try {
      if (pageId) {
        // Update existing page
        console.error("Updating existing page:", pageId);
        return await this.updatePage(pageId, pageTitle, content);
      } else {
        // Create new page
        console.error("Creating new page");
        return await this.createPage(pageTitle, content, parentPageId);
      }
    } catch (error: any) {
      console.error("=== Confluence Error ===");
      console.error("Status:", error.response?.status);
      console.error("Status Text:", error.response?.statusText);
      console.error("Error Data:", JSON.stringify(error.response?.data, null, 2));
      console.error("Request URL:", error.config?.url);
      console.error("Request Method:", error.config?.method);
      throw new Error(
        `Failed to post to Confluence: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Create a new Confluence page
   */
  private async createPage(
    title: string,
    content: string,
    parentId?: string
  ): Promise<{ id: string; url: string }> {
    const body: any = {
      type: "page",
      title,
      space: {
        key: this.spaceKey,
      },
      body: {
        storage: {
          value: content,
          representation: "storage",
        },
      },
    };

    if (parentId) {
      body.ancestors = [{ id: parentId }];
    }

    console.error("Creating Confluence page with:");
    console.error("  Space Key:", this.spaceKey);
    console.error("  Title:", title);
    console.error("  Base URL:", this.client.defaults.baseURL);

    try {
      const response = await this.client.post("/content", body);

      const baseUrl = this.client.defaults.baseURL || '';
      const pageUrl = `${baseUrl.replace('/wiki/rest/api', '')}/wiki/spaces/${this.spaceKey}/pages/${response.data.id}`;

      console.error("Page created successfully:", pageUrl);

      return {
        id: response.data.id,
        url: pageUrl,
      };
    } catch (error: any) {
      console.error("Confluence API error:", error.response?.status, error.response?.statusText);
      console.error("Error details:", error.response?.data);
      throw error;
    }
  }

  /**
   * Update an existing Confluence page
   */
  private async updatePage(
    pageId: string,
    title: string,
    content: string
  ): Promise<{ id: string; url: string }> {
    // Get current page version
    const currentPage = await this.client.get(`/content/${pageId}`);
    const currentVersion = currentPage.data.version.number;

    const body = {
      version: {
        number: currentVersion + 1,
      },
      title,
      type: "page",
      body: {
        storage: {
          value: content,
          representation: "storage",
        },
      },
    };

    const response = await this.client.put(`/content/${pageId}`, body);

    const pageUrl = `${this.client.defaults.baseURL?.replace('/rest/api', '')}/pages/${response.data.id}`;

    return {
      id: response.data.id,
      url: pageUrl,
    };
  }

  /**
   * Format logs into Confluence storage format (HTML)
   */
  private formatLogsForConfluence(logs: string): string {
    // Check if this is already Confluence-compatible HTML (no DOCTYPE, just div/table content)
    if (logs.trim().startsWith('<div') || logs.trim().startsWith('<table')) {
      // Already clean HTML - return as is
      return logs;
    }

    // Check if this is a full HTML document (contains <!DOCTYPE or <html>)
    if (logs.trim().startsWith('<!DOCTYPE') || logs.trim().startsWith('<html')) {
      // Extract body content
      const bodyMatch = logs.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      if (bodyMatch) {
        return bodyMatch[1].trim();
      }
      // If no body tag, strip document structure tags
      return logs
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<!DOCTYPE[^>]*>/gi, '')
        .replace(/<\/?html[^>]*>/gi, '')
        .replace(/<\/?head[^>]*>/gi, '')
        .replace(/<\/?body[^>]*>/gi, '')
        .trim();
    }

    // Check if logs is a JSON string
    try {
      const parsed = JSON.parse(logs);
      const formattedJson = JSON.stringify(parsed, null, 2);
      return `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">json</ac:parameter><ac:plain-text-body><![CDATA[${formattedJson}]]></ac:plain-text-body></ac:structured-macro>`;
    } catch {
      // Not JSON, treat as markdown or plain text
      // Simple markdown to HTML conversion
      let html = logs
        .replace(/^# (.+)$/gm, "<h1>$1</h1>")
        .replace(/^## (.+)$/gm, "<h2>$1</h2>")
        .replace(/^### (.+)$/gm, "<h3>$1</h3>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/^- (.+)$/gm, "<li>$1</li>")
        .replace(/```([^`]+)```/g, "<ac:structured-macro ac:name=\"code\"><ac:plain-text-body><![CDATA[$1]]></ac:plain-text-body></ac:structured-macro>")
        .replace(/\n/g, "<br/>");

      // Wrap list items in <ul>
      html = html.replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>");

      return html;
    }
  }

  /**
   * Search for existing pages by title
   */
  async findPageByTitle(title: string): Promise<string | null> {
    try {
      const response = await this.client.get("/content", {
        params: {
          spaceKey: this.spaceKey,
          title,
          type: "page",
        },
      });

      if (response.data.results && response.data.results.length > 0) {
        return response.data.results[0].id;
      }

      return null;
    } catch (error) {
      console.error("Error finding page:", error);
      return null;
    }
  }
}
