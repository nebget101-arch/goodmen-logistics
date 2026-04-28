# FleetNeuron agents — Claude Code rules

## Project paths
- Application codebase (this repo): ~/Desktop/FleetNeuronAPP
- Agent definitions: ~/Desktop/FleetNeuronAPP/.agent/
- Jira project key: FN
- Confluence space key: FN

## FleetNeuronAPP integration branch: `dev`
**ALWAYS** branch from `origin/dev` and create PRs targeting `dev`. Never target `main` unless the user explicitly says otherwise.

### Branching workflow — Story WITHOUT subtasks (or single-agent task):
1. `git fetch origin dev` — get latest dev
2. `git worktree add .claude/worktrees/<slug> -b <agent>/<jira-key>/<slug> origin/dev` — isolated worktree per agent
3. Make changes, commit (stage explicit paths: `git add <file>`)
4. `git push -u origin <agent>/<jira-key>/<slug>` — push branch
5. `gh pr create --base dev` — PR always targets dev
6. If `dev` advances mid-work: `git fetch origin dev && git rebase origin/dev` — **NEVER `git merge origin/dev`** (merge can silently absorb uncommitted work during conflict resolution; rebase fails loudly)

### Branching workflow — Story WITH subtasks (integration-branch model):
1. **First subtask agent** creates `integration/FN-STORY` from `origin/dev` if it doesn't exist (see `.claude/skills/implement-ticket/SKILL.md`)
2. Each subtask: `git worktree add .claude/worktrees/<slug> -b <agent>/FN-XXX/<slug> origin/integration/FN-STORY`
3. When subtask is done: `git fetch && git rebase origin/integration/FN-STORY` (resolve conflicts here, where the agent knows the code), then ff-merge into `integration/FN-STORY` and push
4. When all subtasks Done: `/create-pr FN-STORY` rebases the integration branch on latest `dev` and opens **one PR**: `integration/FN-STORY → dev`

**Why integration branch:** siblings share a base, so each subtask sees prior subtasks' changes. Conflicts surface incrementally and are resolved by the agent who wrote the code, not at PR-assembly time when no one has full context.

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

- **Mandatory worktree per active agent**: every agent runs in its own `git worktree add` directory under `.claude/worktrees/<slug>`. Never share a working tree between agents — stash collisions silently lose work. Use `git checkout -b` only inside a fresh worktree, never in the main checkout.
- **Rebase, not merge, when syncing**: `git rebase origin/dev` (or `origin/integration/FN-X`). Never `git merge origin/dev` mid-implementation — merge can silently consume uncommitted work during conflict resolution; rebase fails loudly.
- **Clean tree before branch switches**: Run `git status` first. If not clean, stash and tell the user.
- **Intentional commits only**: Stage with explicit paths (`git add <files>`) — never `git add .` or `git add -A`. Run `git diff --cached` before `git commit`.
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
- Each subtask gets its own branch: `<agent>/FN-XXX/<slug>` branched from `origin/integration/FN-PARENT` (NOT `origin/dev`)
- No individual PR — subtask rebases on the integration branch, then ff-merges into `integration/FN-PARENT`
- Transition to Done when subtask is integrated and pushed

**Story**: `Backlog → Selected for Dev → In Progress → Code Review → QA → Done`
- If story has subtasks: the integration branch `integration/FN-STORY` is the merge target; subtasks merge into it; final PR is `integration/FN-STORY → dev`
- If story has no subtasks: standard single-branch workflow off `dev`
- A story with subtasks does **not** have its own implementation branch — the integration branch IS the PR head

**Epic**: `Backlog → In Progress (auto) → Done (auto)`
- Auto-transitions to In Progress when first child story starts
- Auto-transitions to Done when ALL child stories are Done

### Subtask Branch & Merge Strategy (integration-branch model)
```
Epic: FN-100
  Story: FN-101 → integration/FN-101 (created by first subtask agent from origin/dev)
    Subtask: FN-102 → frontend/FN-102/<slug> (branched off integration/FN-101)
    Subtask: FN-103 → backend/FN-103/<slug>  (branched off integration/FN-101)
    Subtask: FN-104 → qa/FN-104/<slug>       (only if automation)

Each subtask on completion:
  git fetch origin integration/FN-101
  git rebase origin/integration/FN-101         # surface conflicts on the subtask side
  git push --force-with-lease origin HEAD
  git checkout integration/FN-101
  git merge --ff-only <subtask-branch>
  git push origin integration/FN-101

When all subtasks Done:
  /create-pr FN-101 → rebases integration/FN-101 on latest dev → single PR: integration/FN-101 → dev
```

**Anti-pattern (forbidden):** branching subtasks off `origin/dev` independently and merging them with `--no-ff` into a fresh story branch at PR time. This is the pattern that caused historical lost-changes incidents — siblings have stale, divergent bases and conflict resolution at PR time has no agent context.

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
