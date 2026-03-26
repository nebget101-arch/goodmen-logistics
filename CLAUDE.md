# FleetNeuron agents — Claude Code rules

## Project paths
- Application codebase (this repo): ~/Desktop/FleetNeuronAPP
- Agent definitions: ~/Desktop/FleetNeuronAPP/.agent/
- Jira project key: FN
- Confluence space key: FN

## FleetNeuronAPP integration branch: `dev`
**ALWAYS** branch from `origin/dev` and create PRs targeting `dev`. Never target `main` unless the user explicitly says otherwise.

### Branching workflow (all sessions must follow):
1. `git fetch origin dev` — get latest dev
2. `git checkout -b <branch-name> origin/dev` — create new branch from dev
3. Make changes, commit
4. `git push -u origin <branch-name>` — push branch
5. `gh pr create --base dev` — PR always targets dev
6. If merge conflicts arise: `git fetch origin dev && git merge origin/dev` and resolve

## Which agent may edit FleetNeuronAPP?

| Mode | Edits FleetNeuronAPP? |
|------|-----------------------|
| **TPM** (project management / analysis) | **No** — read-only via Jira MCP |
| **Frontend developer** | **Yes** — Angular UI scope; branches `agent/frontend/...` |
| **Backend developer** | **Yes** — Node.js/Express microservices scope; branches `agent/backend/...` |
| **Database agent** | **Yes** — PostgreSQL migrations/queries; branches `agent/database/...` |
| **DevOps agent** | **Yes** — Docker/Render/infra scope; branches `agent/devops/...` |
| **QA agent** | **Yes** — Cypress/k6/Karate tests; branches `agent/qa/...` |
| **AI agent** | **Yes** — AI service, Claude API; branches `agent/ai/...` |

All **prompt and config** files live in `.agent/`. The TPM agent never creates, edits, or deletes app source files.

## Trigger phrases → agent workflows

### TPM Agent
"analyze the codebase" or "scan FleetNeuron" or "what's in the app"
→ Read `.agent/tpm/prompts/analyze_codebase.md` and follow exactly.

"create backlog" or "generate tickets" or "create jira stories"
→ Read `.agent/tpm/system_prompt.md` first, then `.agent/tpm/prompts/create_backlog.md`

"sync docs" or "update confluence" or "update documentation"
→ Read `.agent/tpm/prompts/sync_docs.md` and follow exactly.

"audit tests" or "find missing tests" or "test coverage"
→ Read `.agent/tpm/prompts/audit_tests.md` and follow exactly.

"handoff to dev agents" or "add copy-paste prompts for agents"
→ Read `.agent/tpm/prompts/handoff_to_dev_agents.md`

"process work queue" or "start next task" or "pick up FN work"
→ Read `.agent/docs/process_work_queue.md`

"process frontend work queue" / "process backend work queue" / "process database work queue"
"process devops work queue" / "process qa work queue" / "process ai work queue"
→ Read `.agent/docs/process_work_queue.md` and use the matching queue folder.

### Frontend Agent
"analyze UI" or "analyze the frontend" or "UI code review" (read-only — no edits or git)
→ Read `.agent/frontend/system_prompt.md`, then `.agent/frontend/prompts/analyze_frontend_code.md`

"implement UI task" or "frontend agent" or "FleetNeuron frontend" or "polish the UI"
→ Read `.agent/frontend/system_prompt.md` first, then `.agent/frontend/prompts/implement_frontend_task.md`

### Backend Agent
"analyze backend" or "backend code review" or "scan the backend" (read-only)
→ Read `.agent/backend/system_prompt.md`, then `.agent/backend/prompts/analyze_backend_code.md`

"implement backend task" or "backend agent" or "FleetNeuron backend"
→ Read `.agent/backend/system_prompt.md` first, then `.agent/backend/prompts/implement_backend_task.md`

### Database Agent
"analyze database" or "database schema review" (read-only)
→ Read `.agent/database/system_prompt.md`, then `.agent/database/prompts/analyze_database.md`

"implement database task" or "database agent" or "write migration"
→ Read `.agent/database/system_prompt.md` first, then `.agent/database/prompts/implement_database_task.md`

### DevOps Agent
"analyze infrastructure" or "devops review" (read-only)
→ Read `.agent/devops/system_prompt.md`, then `.agent/devops/prompts/analyze_infrastructure.md`

"implement devops task" or "devops agent" or "update docker" or "update render"
→ Read `.agent/devops/system_prompt.md` first, then `.agent/devops/prompts/implement_devops_task.md`

### QA Agent
"implement qa task" or "qa agent" or "write tests" or "write e2e tests"
→ Read `.agent/qa/system_prompt.md` first, then `.agent/qa/prompts/implement_qa_task.md`

### AI Agent
"implement ai task" or "ai agent" or "FleetNeuron AI" or "update ai service"
→ Read `.agent/ai/system_prompt.md` first, then `.agent/ai/prompts/implement_ai_task.md`

## Parallel agents / git safety

- **Separate working trees**: Use `git worktree add` for parallel agent sessions so each has its own folder and branch.
- **Clean tree before branch switches**: Run `git status` first. If not clean, stash and tell the user.
- **Intentional commits only**: Stage with explicit paths (`git add <files>`). Run `git diff --cached` before `git commit`.
- **One branch per agent/task**: `agent/frontend/…`, `agent/backend/…`, etc. Never reset or reuse another agent's branch.

## Jira Status Lifecycle

Agents transition FN issues using `transitionJiraIssue` with these IDs.
Cloud ID: `aff43a9d-6456-476c-9aa5-1b3da163f242`

| Stage | Transition ID | When to apply |
|-------|--------------|---------------|
| **Backlog** | `11` | Default state for new issues |
| **Selected for Development** | `21` | Issue picked from queue, ready for agent |
| **In Progress** | `31` | Implementation started (branch created) |
| **In Testing** | `51` | Implementation done; verifying in browser/tests |
| **Code Review** | `61` | Pull request created and pushed |
| **Done** | `41` | PR merged or QA passed |
| **Canceled** | `71` | Issue no longer needed |

### Lifecycle by Issue Type

**Subtask**: `Backlog → Selected for Dev → In Progress → Done`
- Each subtask gets its own branch: `<agent>/FN-XXX/<slug>`
- No individual PR — subtask branches merge into the story branch
- Transition to Done when implementation is committed and pushed

**Story**: `Backlog → Selected for Dev → In Progress → Code Review → QA → Done`
- If story has subtasks: implement subtasks first, then `/create-pr` merges all subtask branches
- If story has no subtasks: standard single-branch workflow
- Story branch (merge target): `<agent>/FN-STORY/<slug>`

**Epic**: `Backlog → In Progress (auto) → Done (auto)`
- Auto-transitions to In Progress when first child story starts
- Auto-transitions to Done when ALL child stories are Done

### Subtask Branch & Merge Strategy
```
Epic: FN-100
  Story: FN-101 → branch: frontend/FN-101/feature-name (merge target)
    Subtask: FN-102 → branch: frontend/FN-102/component-work
    Subtask: FN-103 → branch: backend/FN-103/api-endpoint
    Subtask: FN-104 → branch: qa/FN-104/validation (only if automation)

When all subtasks Done:
  /create-pr FN-101 → merges FN-102 + FN-103 branches → single PR → dev
```

### QA Evidence
- Screenshots saved to `docs/stories/evidence/FN-XXX/`
- Committed to repo and linked in Jira comments
- QA subtasks with automation work get their own branch
- QA subtasks with manual testing only: evidence + story doc update, no branch

## Routine after coding (coding agents)

When implementation is complete for a Jira Story:

1. **Transition to In Testing** (`51`) — run all verifications (browser, tests, screenshots).
2. **Open a pull request** into `dev` (`gh pr create --base dev`).
3. **Transition to Code Review** (`61`) — do this immediately after the PR is created.
4. **Jira — Story comment**: Add a comment with **(1) PR link** and **(2) Render service names** from `.agent/docs/render_services.md`.
5. **Jira — Sub-tasks**: Transition all completed child issues to **Done** (`41`).

## After a PR merges

1. **Transition story to Done** (`41`).
2. Add a follow-up Jira comment if needed (deploy confirmation, Render service names, prod promotion).
3. Move the work-queue packet to `done/FN-XXX.md`.

## General rules (always apply)
- Always search Jira (project = FN) before creating any issue
- Always confirm before bulk-creating more than 5 issues
- Always link subtasks → stories → epics
- Always use templates from `.agent/tpm/system_prompt.md` for Jira issues
- Always reference actual file paths from ~/Desktop/FleetNeuronAPP in issue descriptions
- Read git log when analyzing to understand recent work
