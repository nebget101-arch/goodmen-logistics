import { Octokit } from "@octokit/rest";

export class GitHubService {
  private octokit: Octokit;
  private owner: string;
  private repo: string;
  private workflowFile: string;

  constructor(token: string, owner: string, repo: string, workflowFile: string) {
    this.octokit = new Octokit({ auth: token });
    this.owner = owner;
    this.repo = repo;
    this.workflowFile = workflowFile;
  }

  async triggerWorkflow(branch: string = "main", workflowFile?: string, inputs?: Record<string, any>) {
    try {
      const workflow = workflowFile || this.workflowFile;
      const response = await this.octokit.actions.createWorkflowDispatch({
        owner: this.owner,
        repo: this.repo,
        workflow_id: workflow,
        ref: branch,
        inputs: inputs || {},
      });

      return {
        success: true,
        message: `Workflow ${workflow} triggered successfully on branch: ${branch}`,
        status: response.status,
        branch,
        workflow,
        inputs,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        message: "Failed to trigger workflow",
      };
    }
  }

  async getWorkflowRuns(limit: number = 10, branch?: string, workflowFile?: string) {
    try {
      const workflow = workflowFile || this.workflowFile;
      const params: any = {
        owner: this.owner,
        repo: this.repo,
        workflow_id: workflow,
        per_page: limit,
      };

      if (branch) {
        params.branch = branch;
      }

      const response = await this.octokit.actions.listWorkflowRuns(params);

      const runs = response.data.workflow_runs.map((run) => ({
        id: run.id,
        name: run.name,
        status: run.status,
        conclusion: run.conclusion,
        branch: run.head_branch,
        commit: run.head_sha.substring(0, 7),
        created_at: run.created_at,
        updated_at: run.updated_at,
        html_url: run.html_url,
        run_number: run.run_number,
      }));

      return {
        total_count: response.data.total_count,
        runs,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        message: "Failed to get workflow runs",
      };
    }
  }

  async getWorkflowRunDetails(runId: number) {
    try {
      const [runResponse, jobsResponse] = await Promise.all([
        this.octokit.actions.getWorkflowRun({
          owner: this.owner,
          repo: this.repo,
          run_id: runId,
        }),
        this.octokit.actions.listJobsForWorkflowRun({
          owner: this.owner,
          repo: this.repo,
          run_id: runId,
        }),
      ]);

      const run = runResponse.data;
      const jobs = jobsResponse.data.jobs.map((job) => ({
        id: job.id,
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
        started_at: job.started_at,
        completed_at: job.completed_at,
        steps: job.steps?.map((step) => ({
          name: step.name,
          status: step.status,
          conclusion: step.conclusion,
          number: step.number,
        })),
      }));

      return {
        id: run.id,
        name: run.name,
        status: run.status,
        conclusion: run.conclusion,
        branch: run.head_branch,
        commit: run.head_sha.substring(0, 7),
        commit_message: run.head_commit?.message,
        created_at: run.created_at,
        updated_at: run.updated_at,
        html_url: run.html_url,
        run_number: run.run_number,
        jobs,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        message: "Failed to get workflow run details",
      };
    }
  }

  async getWorkflowRunLogs(runId: number) {
    try {
      const response = await this.octokit.actions.downloadWorkflowRunLogs({
        owner: this.owner,
        repo: this.repo,
        run_id: runId,
      });

      // The response is a redirect URL to download logs
      return `Logs download URL: ${response.url}\n\nNote: GitHub Actions logs are archived. Use the URL above to download the full logs, or check individual job logs in the GitHub UI.`;
    } catch (error: any) {
      return `Failed to get workflow run logs: ${error.message}`;
    }
  }

  async cancelWorkflowRun(runId: number) {
    try {
      await this.octokit.actions.cancelWorkflowRun({
        owner: this.owner,
        repo: this.repo,
        run_id: runId,
      });

      return {
        success: true,
        message: `Workflow run ${runId} cancelled successfully`,
        run_id: runId,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        message: "Failed to cancel workflow run",
      };
    }
  }

  async rerunWorkflow(runId: number) {
    try {
      await this.octokit.actions.reRunWorkflow({
        owner: this.owner,
        repo: this.repo,
        run_id: runId,
      });

      return {
        success: true,
        message: `Workflow run ${runId} re-run triggered successfully`,
        run_id: runId,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        message: "Failed to re-run workflow",
      };
    }
  }
}
