---
name: implement-ticket
description: Implementing agent reads Jira + story doc, creates branch, implements scoped work, updates docs, and documents deployment handoff.
user_invocable: true
args: "<jira-key>"
---

# /implement-ticket — Implement a Jira Ticket

Implement the specified Jira ticket following the workflow rules.

## Input
The argument is the Jira key (e.g., `FN-42`).

## Constants
- **Jira Cloud ID**: `aff43a9d-6456-476c-9aa5-1b3da163f242`
- **PR base branch**: `dev`
- **Transition IDs**: Selected for Development=`21`, In Progress=`31`, In Testing=`51`, Code Review=`61`, Done=`41`
- **Assignee**: Read from `.agent/jira_defaults.json` (`defaultAssigneeAccountId`). If rejected, use `lookupJiraAccountId` with `defaultAssigneeLookupEmail`.

## Steps

### 1. Read the Ticket
- Fetch the Jira issue using `getJiraIssue` with key `$ARGS` (cloudId: `aff43a9d-6456-476c-9aa5-1b3da163f242`)
- Determine if this is a **Story** or **Subtask** (check `issuetype` field)
- Read `docs/stories/$ARGS.md` (for stories) or the parent story doc (for subtasks)
- Identify the agent type from the ticket labels
- Verify the ticket is in "Selected for Development" or "In Progress" status

### 2. Route by Ticket Type

**If Story WITH subtasks:**
- Do NOT implement directly
- Print: "Story FN-XXX has subtasks. Implement subtasks individually first, then run `/create-pr FN-XXX` to merge."
- List the subtasks and their statuses
- STOP

**If Story WITHOUT subtasks:**
- Proceed with standard implementation (step 3 onward)
- Branch: `<agent>/$ARGS/<slug>`

**If Subtask:**
- Proceed with subtask implementation (step 3 onward)
- Branch: `<agent>/$ARGS/<slug>` (use subtask key, not parent story key)
- Scope work to subtask acceptance criteria only

### 3. Create Branch (in an isolated worktree)

Every agent MUST work in its own `git worktree`. Never run `git checkout -b` in a shared working tree — that's how parallel agents collide and lose changes.

**Determine the story shape (subtask path only):**

When implementing a subtask, classify the parent story BEFORE choosing a branch base:

1. Query Jira: list all subtasks under `FN-PARENT` and count those with status != Done AND label != `agent:qa`. Include the current subtask in the count.
2. Read `docs/stories/FN-PARENT.md` and parse the `## Integration Branch` field — it should contain either `_none — single-agent_`/`_none — standalone_` or `integration/FN-PARENT`.
3. Reconcile:
   - **Count = 1 AND doc says single-agent**: SINGLE-AGENT path. Base is `origin/dev` directly. No integration branch.
   - **Count >= 2 AND doc says integration**: MULTI-AGENT path. Base is `origin/integration/FN-PARENT`.
   - **Count = 1 AND doc says integration** (subtasks were collapsed/closed after intake): treat as SINGLE-AGENT, but print a note: `autopilot: collapsed integration story FN-PARENT to single-agent path`.
   - **Count >= 2 AND doc says single-agent** (subtask was added after intake): STOP. Print: `Story FN-PARENT was classified single-agent but now has 2+ non-QA subtasks. Either split the second subtask into a new story, or manually migrate FN-PARENT to integration-branch mode: create integration/FN-PARENT from origin/dev, rebase the existing subtask branch onto it, ff-merge, then re-run.`
   - **Doc field missing/unparseable**: STOP and ask the TPM to refresh the story doc.

**Determine the base branch:**
- **Story without subtasks**: base is `origin/dev`
- **Subtask under SINGLE-AGENT story**: base is `origin/dev`
- **Subtask under MULTI-AGENT story**: base is `origin/integration/FN-PARENT`

**Ensure the integration branch exists (MULTI-AGENT path only):**
```
git fetch origin
if ! git rev-parse --verify origin/integration/FN-PARENT >/dev/null 2>&1; then
  # First subtask agent — create the integration branch from current dev tip
  git push origin origin/dev:refs/heads/integration/FN-PARENT
  git fetch origin integration/FN-PARENT
fi
```

For SINGLE-AGENT path, skip the integration branch step entirely.

**Create the worktree + branch:**
```
git worktree add .claude/worktrees/$ARGS -b <agent>/$ARGS/<slug> origin/<base>
cd .claude/worktrees/$ARGS
```

Where `<agent>` matches the label (`frontend`, `backend`, `database`, `qa`), `<slug>` is a short kebab-case description, and `<base>` is `dev` (no-subtask story OR single-agent subtask) or `integration/FN-PARENT` (multi-agent subtask). AI-service AND infra/Docker/Render work both use `agent:backend` — there are no separate `ai` or `devops` agents.

### 4. Move to In Progress
- Transition the Jira issue to "In Progress" using `transitionJiraIssue` (transition ID `31`)
- Set assignee using `editJiraIssue` with `assignee: { accountId }` from `.agent/jira_defaults.json`
- **Epic auto-transition**: Check if this ticket's parent epic is still in Backlog. If so, transition the epic to "In Progress" too.

### 5. Implement
- Work ONLY within the agent's domain directory
- Implement ONLY what the acceptance criteria require — no scope creep
- Follow existing code patterns in the repository
- Write or update tests for the changes

### 6. Update Documentation

**If Story (no subtasks):**
- Update `docs/stories/$ARGS.md` with Implementation Summary, Files Changed, Key Decisions, Deployment Handoff

**If Subtask:**
- Update the parent story doc (`docs/stories/FN-PARENT.md`):
  - Mark this subtask as Done in the `## Subtasks` table
  - Add branch name to the subtask row
  - Append implementation notes under a `### FN-XXX (subtask)` sub-heading
- Add a Jira comment on the subtask with the branch name: `Branch: <agent>/$ARGS/<slug>`

### 7. Document Deployment Handoff (REQUIRED)
In the story doc, fill or update the **Deployment Handoff** section:
- Services to restart/redeploy (reference `.agent/docs/render_services.md`)
- Jobs/workers affected
- DB migrations to run (include migration file names)
- Environment/config changes (new env vars, changed values)
- Cache invalidation needs
- Feature flags to enable/disable
- Deploy order (if multi-service changes)
- Post-deploy verification steps

### 8. Commit
Stage and commit changes with message: `[$ARGS] <description>`

### 9. Handle Subtask Completion
**If Subtask:**

Branch the completion flow on the story shape decided in step 3.

#### 9a. SINGLE-AGENT path (base was `origin/dev`)

1. **Sync with dev (rebase, never merge):**
   ```
   git fetch origin dev
   git rebase origin/dev
   ```
   If rebase has conflicts, resolve them (you wrote the code). If too tangled, STOP and report.

2. **Push the subtask branch:**
   ```
   git push -u origin HEAD --force-with-lease
   ```
   (force-with-lease is needed because the rebase rewrites local history. No one else writes this branch.)

3. **Transition the subtask to "Done"** in Jira (transition ID `41`).

4. **Output:** "Subtask FN-XXX done on single-agent path. Branch `<agent>/FN-XXX/<slug>` is ready to be the PR head. Run `/create-pr FN-PARENT`."

   No integration branch exists; the subtask branch IS the PR head.

#### 9b. MULTI-AGENT path (base was `origin/integration/FN-PARENT`)

1. **Push the subtask branch:**
   ```
   git push -u origin HEAD
   ```

2. **Integrate into the integration branch (rebase + ff-merge):**
   ```
   git fetch origin integration/FN-PARENT
   git rebase origin/integration/FN-PARENT
   ```
   - If rebase has conflicts: resolve them (you wrote this code — you have full context). Re-run tests/build after resolution.
   - If conflicts are too tangled to safely resolve: STOP, push WIP, and report to user.

   ```
   git push --force-with-lease origin HEAD
   git fetch origin integration/FN-PARENT
   git checkout -B integration/FN-PARENT origin/integration/FN-PARENT
   git merge --ff-only <agent>/$ARGS/<slug>
   git push origin integration/FN-PARENT
   git checkout <agent>/$ARGS/<slug>
   ```

   The `--ff-only` is intentional: the rebase guarantees a fast-forward, so any non-ff outcome means something went wrong (concurrent push) and you must re-fetch and retry.

3. **Transition the subtask to "Done"** in Jira (transition ID `41`).

4. **Check sibling subtasks** (other subtasks under the same parent story):
   - **Exclude `agent:qa` siblings from this check** — QA subtasks default to manual testing post-merge under the current policy, so they don't block PR creation regardless of status. (If a QA subtask is doing real automation work, it'll be `In Progress` — even then, this skill stops on completion of an impl subtask, the user/QA-routine takes over.)
   - If ALL non-QA sibling subtasks are Done: print "All non-QA subtasks complete. Run `/create-pr FN-PARENT` to open the integration-branch PR." — this is the signal for the autopilot tick to proceed to step 3.
   - If some non-QA siblings remain: print "Subtask FN-XXX done, integrated into integration/FN-PARENT. Remaining: FN-YYY (status), FN-ZZZ (status)" (list only non-QA siblings)

### 10. Output
Print:
- Jira key and summary
- Branch name
- Files changed (count)
- Deployment impact summary
- **If story**: Next step: `/create-pr $ARGS`
- **If subtask**: Next step depends on sibling status (see step 9)
