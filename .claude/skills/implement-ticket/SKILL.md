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

**Determine the base branch:**
- **Story without subtasks**: base is `origin/dev`
- **Subtask under a story with subtasks**: base is `origin/integration/FN-PARENT`

**Ensure the integration branch exists (subtask path only):**
```
git fetch origin
if ! git rev-parse --verify origin/integration/FN-PARENT >/dev/null 2>&1; then
  # First subtask agent — create the integration branch from current dev tip
  git push origin origin/dev:refs/heads/integration/FN-PARENT
  git fetch origin integration/FN-PARENT
fi
```

**Create the worktree + branch:**
```
git worktree add .claude/worktrees/$ARGS -b <agent>/$ARGS/<slug> origin/<base>
cd .claude/worktrees/$ARGS
```

Where `<agent>` matches the label (`frontend`, `backend`, `ai`, `database`, `devops`, `qa`), `<slug>` is a short kebab-case description, and `<base>` is `dev` (no-subtask story) or `integration/FN-PARENT` (subtask).

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
   - If ALL sibling subtasks are Done: print "All subtasks complete. Run `/create-pr FN-PARENT` to open the integration-branch PR."
   - If some remain: print "Subtask FN-XXX done, integrated into integration/FN-PARENT. Remaining: FN-YYY (status), FN-ZZZ (status)"

### 10. Output
Print:
- Jira key and summary
- Branch name
- Files changed (count)
- Deployment impact summary
- **If story**: Next step: `/create-pr $ARGS`
- **If subtask**: Next step depends on sibling status (see step 9)
