# FleetNeuron agents — Claude Code rules

## Project paths
- Application codebase (this repo): ~/Desktop/FleetNeuronAPP
- Agent definitions: ~/Desktop/FleetNeuronAPP/.agent/
- Jira project key: FN
- Confluence space key: FN

## FleetNeuronAPP integration branch: `dev`
**ALWAYS** branch from `origin/dev` and create PRs targeting `dev`. Never target `main` unless the user explicitly says otherwise.

There are three story shapes. Pick the one that matches the planned subtask count.

### Shape A — STANDALONE (story has no subtasks)
1. `git fetch origin dev` — get latest dev
2. `git worktree add .claude/worktrees/<slug> -b <agent>/<jira-key>/<slug> origin/dev` — isolated worktree per agent
3. Make changes, commit (stage explicit paths: `git add <file>`)
4. `git push -u origin <agent>/<jira-key>/<slug>` — push branch
5. `gh pr create --base dev` — PR always targets dev
6. If `dev` advances mid-work: `git fetch origin dev && git rebase origin/dev` — **NEVER `git merge origin/dev`** (merge can silently absorb uncommitted work during conflict resolution; rebase fails loudly)

### Shape B — SINGLE-AGENT story (exactly one non-QA subtask)
The single subtask's branch IS the PR head. No integration branch.
1. `git fetch origin dev`
2. `git worktree add .claude/worktrees/<slug> -b <agent>/FN-SUBTASK/<slug> origin/dev` — base off `dev` directly
3. Implement, commit, push
4. When subtask is Done: `git fetch && git rebase origin/dev`, then `git push --force-with-lease origin HEAD`
5. `/create-pr FN-STORY` opens the PR with `--head <agent>/FN-SUBTASK/<slug>` (the subtask branch is the PR head)

### Shape C — MULTI-AGENT story (2+ non-QA subtasks, integration-branch model)
1. **First subtask agent** creates `integration/FN-STORY` from `origin/dev` if it doesn't exist (see `.claude/skills/implement-ticket/SKILL.md`)
2. Each subtask: `git worktree add .claude/worktrees/<slug> -b <agent>/FN-XXX/<slug> origin/integration/FN-STORY`
3. When subtask is done: `git fetch && git rebase origin/integration/FN-STORY` (resolve conflicts here, where the agent knows the code), then ff-merge into `integration/FN-STORY` and push
4. When all subtasks Done: `/create-pr FN-STORY` rebases the integration branch on latest `dev` and opens **one PR**: `integration/FN-STORY → dev`

**Why integration branch (Shape C only):** siblings share a base, so each subtask sees prior subtasks' changes. Conflicts surface incrementally and are resolved by the agent who wrote the code, not at PR-assembly time when no one has full context.

**Why no integration branch for Shape B:** with only one subtask, there are no siblings to share a base with. The integration branch is pure overhead — extra refs, extra ff-merges, no benefit.

**Classification source of truth:** intake records the shape in the story doc's `## Integration Branch` field. Implement-ticket and create-pr re-verify by counting subtasks at runtime; if the count contradicts the doc (e.g., a 2nd subtask was added to a Shape B story after intake), they STOP rather than guess.

## Which agent may edit FleetNeuronAPP?

| Mode | Edits FleetNeuronAPP? |
|------|-----------------------|
| **TPM** (project management / analysis) | **No** — read-only via Jira MCP |
| **Frontend developer** | **Yes** — Angular UI scope; branches `agent/frontend/...` |
| **Backend developer** | **Yes** — Node.js/Express microservices scope (includes AI service work); branches `agent/backend/...` |
| **Database agent** | **Yes** — PostgreSQL migrations/queries; branches `agent/database/...` |
| **DevOps agent** | **Yes** — Docker/Render/infra scope; branches `agent/devops/...` |
| **QA agent** | **Yes** — Cypress/k6/Karate tests; branches `agent/qa/...` |

All **prompt and config** files live in `.agent/`. The TPM agent never creates, edits, or deletes app source files.

**Note on AI service work:** `backend/microservices/ai-service/` is owned by the **backend** agent — no separate `agent:ai` label exists. The autopilot blocklist still blocks auto-merge of ai-service changes (sensitive), so backend agents implementing AI work will still open a PR that waits for human merge.

## Trigger phrases (interactive sessions only)

When a human types natural-language commands (e.g. "analyze the codebase", "implement UI task"), the trigger-phrase → workflow-file mapping is in **`.agent/triggers.md`**. Read that file only when a human prose request needs to be mapped to a workflow. Remote routines and skill invocations (e.g. `/autopilot-tick`, `/work-next`, `/create-pr`) call skills directly and never need this file.

## Parallel agents / git safety

- **Mandatory worktree per active agent**: every agent runs in its own `git worktree add` directory under `.claude/worktrees/<slug>`. Never share a working tree between agents — stash collisions silently lose work. Use `git checkout -b` only inside a fresh worktree, never in the main checkout.
- **Rebase, not merge, when syncing**: `git rebase origin/dev` (or `origin/integration/FN-X`). Never `git merge origin/dev` mid-implementation — merge can silently consume uncommitted work during conflict resolution; rebase fails loudly.
- **Clean tree before branch switches**: Run `git status` first. If not clean, stash and tell the user.
- **Intentional commits only**: Stage with explicit paths (`git add <files>`) — never `git add .` or `git add -A`. Run `git diff --cached` before `git commit`.
- **One branch per agent/task**: `agent/frontend/…`, `agent/backend/…`, etc. Never reset or reuse another agent's branch.

## Scoping the agent queue by epic or lane (optional)

By default, agents pick any task in **Selected for Development** matching `agent:<type>`. To narrow further to a specific epic or swimlane, pass a scope token as the second arg to `/pick-next-task`, `/work-next`, or `/autopilot-tick`:

- `epic:FN-1090` — resolved to the epic's `epic:*` lane label
- `lane:quick-add-part` — uses label `epic:quick-add-part` directly

**Precedence:** CLI arg > `.agent/autopilot_scope.json` per-agent default > no scope. Status filter is always AND-ed on top — scope narrows, never widens.

**Setting scope per routine:** edit the routine prompt in https://claude.ai/code/routines (e.g., `/autopilot-tick backend epic:FN-1090`).
**Setting scope for all routines of an agent:** edit `.agent/autopilot_scope.json` and push to dev.

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
- Branch base depends on parent story shape:
  - **Shape B (single-agent story)**: branched from `origin/dev` directly; the subtask branch IS the eventual PR head
  - **Shape C (multi-agent story)**: branched from `origin/integration/FN-PARENT`
- No individual PR — Shape B subtasks rebase on `origin/dev`; Shape C subtasks rebase on the integration branch then ff-merge into it
- Transition to Done when subtask is rebased and pushed

**Story**: `Backlog → Selected for Dev → In Progress → Code Review → Done`
- The QA step is **skipped by default** — the user tests manually after Code Review and merges when satisfied.
- The `In Testing` (51) and QA-style steps only run when a story has a `agent:qa` automation subtask (rare; only when automation must be written as part of the story). See intake skill for when to create one.
- PR head depends on shape (see "Branching workflow" above):
  - **Shape A (no subtasks)**: PR head is the story's own branch
  - **Shape B (1 non-QA subtask)**: PR head is the subtask's branch — no integration branch involved
  - **Shape C (2+ non-QA subtasks)**: PR head is `integration/FN-STORY` — the integration branch is the merge target for siblings
- For Shape C only: a story with multiple subtasks does **not** have its own implementation branch — the integration branch IS the PR head

**Epic**: `Backlog → In Progress (auto) → Done (auto)`
- Auto-transitions to In Progress when first child story starts
- Auto-transitions to Done when ALL child stories are Done

### Subtask Branch & Merge Strategy

The full step-by-step git commands per shape live in `.claude/skills/implement-ticket/SKILL.md` (§3 branch base, §9 completion) and `.claude/skills/create-pr/SKILL.md` (§2 routing). Implementing agents follow those skills, not free-form recipes here.

**Anti-pattern (forbidden):** branching multi-agent siblings off `origin/dev` independently and merging them with `--no-ff` into a fresh story branch at PR time. This caused historical lost-changes incidents — siblings had stale, divergent bases and conflict resolution at PR time had no agent context. The Shape B single-subtask off-dev path is **not** this anti-pattern, because there are no siblings to diverge from.

### QA Evidence (only when an automation QA subtask exists)
- The default flow has no QA subtask — user tests manually after Code Review and merges. No evidence files required.
- When an automation QA subtask IS created (e.g., new Cypress/Karate suite):
  - Screenshots saved to `docs/stories/evidence/FN-XXX/`
  - Committed to repo and linked in Jira comments
  - The QA subtask gets its own branch
  - Manual-only QA subtasks (legacy): evidence + story doc update, no branch

## Routine after coding (coding agents)

When implementation is complete for a Jira Story:

1. **Run final self-verification** (build passes, tests pass, manual smoke if a UI change). Optionally transition to **In Testing** (`51`) only if the story has an automation QA subtask that will run next.
2. **Open a pull request** into `dev` (`gh pr create --base dev`).
3. **Transition to Code Review** (`61`) — do this immediately after the PR is created.
4. **Jira — Story comment**: Add a comment with **(1) PR link** and **(2) Render service names** from `.agent/docs/render_services.md`.
5. **Jira — Sub-tasks**: Transition all completed child issues to **Done** (`41`).
6. **Stop here.** No QA handoff in the default flow — the user takes over for manual testing and merges when satisfied.

## After a PR merges

1. **Transition story to Done** (`41`).
2. Add a follow-up Jira comment if needed (deploy confirmation, Render service names, prod promotion).
3. Move the work-queue packet to `done/FN-XXX.md`.

## Jira issue-creation rules

Apply only when creating Jira issues (TPM / intake work). See `.claude/skills/intake/SKILL.md` for the full ruleset, including: always search FN before creating, confirm before bulk-creating more than 5 issues, link subtasks → stories → epics, use templates from `.agent/tpm/system_prompt.md`, and reference actual file paths from this repo in descriptions.
