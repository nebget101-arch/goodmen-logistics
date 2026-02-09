import axios from 'axios';

export class ConfluenceService {
  private baseUrl: string;
  private email: string;
  private apiToken: string;
  private spaceKey: string;
  private auth: string;

  constructor(baseUrl: string, email: string, apiToken: string, spaceKey: string) {
    this.baseUrl = baseUrl;
    this.email = email;
    this.apiToken = apiToken;
    this.spaceKey = spaceKey;
    this.auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
  }

  async createPage(title: string, content: string, parentId?: string) {
    try {
      const pageData: any = {
        type: 'page',
        title,
        space: { key: this.spaceKey },
        body: {
          storage: {
            value: content,
            representation: 'storage'
          }
        }
      };

      if (parentId) {
        pageData.ancestors = [{ id: parentId }];
      }

      const response = await axios.post(
        `${this.baseUrl}/rest/api/content`,
        pageData,
        {
          headers: {
            'Authorization': `Basic ${this.auth}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        }
      );

      return {
        success: true,
        pageId: response.data.id,
        pageUrl: `${this.baseUrl}${response.data._links.webui}`,
        title: response.data.title
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  async updatePage(pageId: string, title: string, content: string) {
    try {
      // Get current version
      const currentPage = await axios.get(
        `${this.baseUrl}/rest/api/content/${pageId}`,
        {
          headers: {
            'Authorization': `Basic ${this.auth}`,
            'Accept': 'application/json'
          }
        }
      );

      const updateData = {
        version: {
          number: currentPage.data.version.number + 1
        },
        title,
        type: 'page',
        body: {
          storage: {
            value: content,
            representation: 'storage'
          }
        }
      };

      const response = await axios.put(
        `${this.baseUrl}/rest/api/content/${pageId}`,
        updateData,
        {
          headers: {
            'Authorization': `Basic ${this.auth}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        }
      );

      return {
        success: true,
        pageId: response.data.id,
        pageUrl: `${this.baseUrl}${response.data._links.webui}`,
        version: response.data.version.number
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  async getPages(limit: number = 25) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/rest/api/content`,
        {
          params: {
            spaceKey: this.spaceKey,
            limit,
            expand: 'version,space'
          },
          headers: {
            'Authorization': `Basic ${this.auth}`,
            'Accept': 'application/json'
          }
        }
      );

      return {
        success: true,
        pages: response.data.results.map((page: any) => ({
          id: page.id,
          title: page.title,
          url: `${this.baseUrl}${page._links.webui}`,
          version: page.version.number
        }))
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }
}
