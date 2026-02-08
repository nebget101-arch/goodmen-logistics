import * as fs from "fs";
import * as path from "path";

export interface CodebaseAnalysis {
  relevantFiles: string[];
  impactedComponents: string[];
  estimatedComplexity: "Low" | "Medium" | "High";
  suggestedApproach: string;
  dependencies: string[];
}

export class CodebaseService {
  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  /**
   * Analyze codebase to identify relevant files and components for a requirement
   */
  async analyzeRequirement(requirement: string): Promise<CodebaseAnalysis> {
    const keywords = this.extractKeywords(requirement);
    const relevantFiles: string[] = [];
    const impactedComponents: string[] = [];
    const dependencies: string[] = [];

    // Search through codebase
    await this.searchFiles(this.workspacePath, keywords, relevantFiles);

    // Analyze components
    if (requirement.toLowerCase().includes("driver")) {
      impactedComponents.push("drivers");
      dependencies.push("driver-service", "api-routes");
    }
    if (requirement.toLowerCase().includes("vehicle")) {
      impactedComponents.push("vehicles");
      dependencies.push("vehicle-service", "maintenance");
    }
    if (requirement.toLowerCase().includes("hos") || requirement.toLowerCase().includes("hours of service")) {
      impactedComponents.push("hos");
      dependencies.push("hos-service", "compliance");
    }
    if (requirement.toLowerCase().includes("load")) {
      impactedComponents.push("loads");
      dependencies.push("load-service", "tracking");
    }
    if (requirement.toLowerCase().includes("audit") || requirement.toLowerCase().includes("log")) {
      impactedComponents.push("audit");
      dependencies.push("audit-service", "logging");
    }

    // Estimate complexity
    const complexity = this.estimateComplexity(requirement, impactedComponents.length, relevantFiles.length);

    // Generate suggested approach
    const suggestedApproach = this.generateApproach(requirement, impactedComponents);

    return {
      relevantFiles: relevantFiles.slice(0, 10), // Limit to top 10
      impactedComponents,
      estimatedComplexity: complexity,
      suggestedApproach,
      dependencies,
    };
  }

  /**
   * Extract keywords from requirement text
   */
  private extractKeywords(text: string): string[] {
    const commonWords = new Set(["the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by"]);
    
    return text
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 3 && !commonWords.has(word))
      .slice(0, 10);
  }

  /**
   * Search files for keywords
   */
  private async searchFiles(dir: string, keywords: string[], results: string[]): Promise<void> {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Skip node_modules and hidden files
        if (entry.name.startsWith(".") || entry.name === "node_modules") {
          continue;
        }

        if (entry.isDirectory()) {
          await this.searchFiles(fullPath, keywords, results);
        } else if (entry.isFile() && this.isRelevantFile(entry.name)) {
          // Check if file contains keywords
          try {
            const content = fs.readFileSync(fullPath, "utf-8").toLowerCase();
            if (keywords.some(keyword => content.includes(keyword))) {
              results.push(fullPath.replace(this.workspacePath, ""));
            }
          } catch (error) {
            // Skip files that can't be read
          }
        }

        // Limit results to prevent too many files
        if (results.length >= 20) break;
      }
    } catch (error) {
      // Directory doesn't exist or can't be read
    }
  }

  /**
   * Check if file is relevant for analysis
   */
  private isRelevantFile(filename: string): boolean {
    const extensions = [".ts", ".js", ".html", ".css", ".json"];
    return extensions.some(ext => filename.endsWith(ext));
  }

  /**
   * Estimate complexity based on requirement analysis
   */
  private estimateComplexity(
    requirement: string,
    componentCount: number,
    fileCount: number
  ): "Low" | "Medium" | "High" {
    // High complexity indicators
    if (
      requirement.toLowerCase().includes("integration") ||
      requirement.toLowerCase().includes("migrate") ||
      requirement.toLowerCase().includes("refactor") ||
      componentCount > 3 ||
      fileCount > 10
    ) {
      return "High";
    }

    // Medium complexity indicators
    if (
      requirement.toLowerCase().includes("update") ||
      requirement.toLowerCase().includes("enhance") ||
      componentCount > 1 ||
      fileCount > 5
    ) {
      return "Medium";
    }

    return "Low";
  }

  /**
   * Generate suggested implementation approach
   */
  private generateApproach(requirement: string, components: string[]): string {
    let approach = "";

    if (requirement.toLowerCase().includes("add") || requirement.toLowerCase().includes("create")) {
      approach = `1. Create new service/component in relevant module\n2. Add API endpoints if needed\n3. Update frontend components\n4. Add tests\n5. Update documentation`;
    } else if (requirement.toLowerCase().includes("fix") || requirement.toLowerCase().includes("bug")) {
      approach = `1. Reproduce the issue\n2. Identify root cause in ${components.join(", ")}\n3. Implement fix\n4. Add regression tests\n5. Verify in all affected areas`;
    } else if (requirement.toLowerCase().includes("update") || requirement.toLowerCase().includes("modify")) {
      approach = `1. Review existing implementation in ${components.join(", ")}\n2. Plan changes to avoid breaking existing functionality\n3. Update affected files\n4. Update/add tests\n5. Update documentation`;
    } else {
      approach = `1. Analyze requirement in detail\n2. Review ${components.join(", ")} components\n3. Design solution\n4. Implement changes\n5. Test thoroughly`;
    }

    return approach;
  }
}
