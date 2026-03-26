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

## Steps

### 1. Read the Ticket
- Fetch the Jira issue using `getJiraIssue` with key `$ARGS`
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

### 3. Create Branch
```
git checkout main
git pull origin main
git checkout -b <agent>/$ARGS/<slug>
```
Where `<agent>` matches the label (`frontend`, `backend`, `ai`, `ios`, `qa`) and `<slug>` is a short kebab-case description.

### 4. Move to In Progress
- Transition the Jira issue to "In Progress" using `transitionJiraIssue`
- **Epic auto-transition**: Check if this ticket's parent epic is still in Backlog. If so, transition the epic to "In Progress" too.
  - For subtasks: find the parent story, then the parent epic
  - For stories: find the parent epic directly
  - Use `searchJiraIssuesUsingJql` with `project = FN AND issuetype = Epic AND issue in parentEpicOf("$ARGS")` or check the epic link field

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
- Services to restart/redeploy
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
- Push the branch: `git push -u origin HEAD`
- Transition the subtask to "Done" in Jira
- Check sibling subtasks (other subtasks under the same parent story):
  - If ALL sibling subtasks are Done: print "All subtasks complete. Run `/create-pr FN-PARENT` to merge and create the story PR."
  - If some remain: print "Subtask FN-XXX done. Remaining: FN-YYY (status), FN-ZZZ (status)"

### 10. Output
Print:
- Jira key and summary
- Branch name
- Files changed (count)
- Deployment impact summary
- **If story**: Next step: `/create-pr $ARGS`
- **If subtask**: Next step depends on sibling status (see step 9)
