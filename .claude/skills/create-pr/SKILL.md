---
name: create-pr
description: Create a PR with Jira key in title, structured body including deployment notes, and transition Jira to Code Review.
user_invocable: true
args: "<jira-key>"
---

# /create-pr — Create Pull Request

Create a properly formatted PR and link it to Jira.

## Input
The argument is the Jira key (e.g., `FN-42`). This should be a **Story** key, not a subtask.

## Constants
- **Jira Cloud ID**: `aff43a9d-6456-476c-9aa5-1b3da163f242`
- **PR base branch**: `dev` (always — never `main` unless user explicitly says otherwise)
- **Transition IDs**: In Testing=`51`, Code Review=`61`, Done=`41`

## Steps

### 1. Gather Context
- Fetch the Jira issue with `getJiraIssue` for `$ARGS` (cloudId: `aff43a9d-6456-476c-9aa5-1b3da163f242`)
- Determine if this is a **Story with subtasks**, **Story without subtasks**, or **Subtask**
- Read `docs/stories/$ARGS.md` if it exists

**If Subtask:**
- Print error: "Subtasks don't get individual PRs. Run `/create-pr FN-PARENT` on the parent story instead."
- STOP

### 2. Route by Story Type

#### Story WITHOUT subtasks (standard flow)
- Run `git log dev..HEAD --oneline` to see commits
- Run `git diff dev...HEAD --stat` for changed files summary
- Proceed to step 3

#### Story WITH subtasks (integration-branch flow)

**Pre-flight guards — run all of these before touching git:**

1. **All subtasks Done?** If any are not Done:
   - Print: "Cannot create PR — these subtasks are not Done: FN-XXX (status), FN-YYY (status)"
   - STOP

2. **Duplicate-agent guard.** Count subtasks by `agent:*` label, excluding `agent:qa`. If two or more non-QA subtasks share the same agent label:
   - Print: "Story $ARGS has multiple subtasks with label `agent:<label>`. This violates the one-subtask-per-agent rule (.claude/skills/intake/SKILL.md). Split this into separate stories or collapse the subtasks before creating the PR."
   - STOP

3. **Integration branch exists?**
   ```
   git fetch origin integration/$ARGS
   git rev-parse --verify origin/integration/$ARGS
   ```
   If not found:
   - Print: "Integration branch `integration/$ARGS` not found. This story was implemented under the legacy fan-merge model. Either: (a) reconstruct integration manually with `git checkout -b integration/$ARGS origin/dev && git merge --ff-only <each-subtask>` if subtasks were rebased before completion, or (b) escalate to user."
   - STOP

**Rebase the integration branch on latest dev:**
```
git fetch origin dev integration/$ARGS
git worktree add .claude/worktrees/$ARGS-pr -B integration/$ARGS origin/integration/$ARGS
cd .claude/worktrees/$ARGS-pr
git rebase origin/dev
```

If conflicts surface during the dev-rebase:
- These are conflicts between the story's accumulated changes and other PRs that landed on dev since intake. The agent who wrote the conflicting subtask code may not be available.
- If conflicts are within a single subtask's diff: resolve carefully and document in the PR body.
- If conflicts span multiple subtasks: STOP and report to user — this needs human review.

```
git push --force-with-lease origin integration/$ARGS
```

Run `git log origin/dev..HEAD --oneline` to see all integrated subtask commits.
Run `git diff origin/dev...HEAD --stat` for combined changed files summary.

**The PR head is `integration/$ARGS`.** Skip step 3 (rebase already done) and step 4 (already pushed). Proceed directly to step 5 with `--head integration/$ARGS`.

### 3. Rebase on Dev (standard flow only)
Skip this step for the integration-branch flow (already rebased in step 2).

For standard flow:
```
git fetch origin dev
git rebase origin/dev
```
Resolve conflicts if any. If conflicts are complex, STOP and report to user.

### 4. Push Branch (standard flow only)
Skip for integration-branch flow (already pushed in step 2).

```
git push -u origin HEAD
```

### 5. Create PR
Use `gh pr create --base dev` with this format (PRs always target `dev`, never `main`).

**Standard flow:** `gh pr create --base dev` (uses current branch as head)
**Integration-branch flow:** `gh pr create --base dev --head integration/$ARGS`

**Title**: `[$ARGS] <Jira summary>`

**Body** (standard flow):
```markdown
## Summary
<1-3 bullet points of what changed and why>

## Acceptance Criteria
- [ ] <each AC item from Jira ticket>

## Tests
- <what tests were added/modified>

## Risks
- <potential regression or side effects>

## Story Doc
- [docs/stories/$ARGS.md](docs/stories/$ARGS.md)

## Deployment / Restart Notes
- **Services to restart/redeploy**: <list>
- **Migrations**: <migration files or "none">
- **Env/config changes**: <new vars or "none">
- **Post-deploy verification**: <steps to verify>

---
Jira: $ARGS
```

**Body** (integration-branch flow — add subtask section):
```markdown
## Summary
<1-3 bullet points of what changed and why>

## Subtasks Merged
| Subtask | Summary | Branch | Agent |
|---------|---------|--------|-------|
| FN-XXX | <summary> | `<branch>` | frontend |
| FN-YYY | <summary> | `<branch>` | backend |

## Acceptance Criteria
- [ ] <each AC item from Jira ticket>

## Tests
- <what tests were added/modified>

## Risks
- <potential regression or side effects>

## Story Doc
- [docs/stories/$ARGS.md](docs/stories/$ARGS.md)

## Deployment / Restart Notes
- **Services to restart/redeploy**: <list>
- **Migrations**: <migration files or "none">
- **Env/config changes**: <new vars or "none">
- **Post-deploy verification**: <steps to verify>

---
Jira: $ARGS
```

### 6. Transition Jira
- Move the Story to "Code Review" using `transitionJiraIssue` (transition ID `61`)
- Add a Jira comment with the PR URL
- Include Render service names from `.agent/docs/render_services.md` if available

### 7. Output
Print:
- PR URL
- Jira key and new status
- PR head branch (e.g., `integration/$ARGS` for integration-branch flow)
- Subtask branches merged into integration (if integration-branch flow)
- Next step: `/review-ticket $ARGS`
