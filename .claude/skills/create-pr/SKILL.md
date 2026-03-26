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

## Steps

### 1. Gather Context
- Fetch the Jira issue with `getJiraIssue` for `$ARGS`
- Determine if this is a **Story with subtasks**, **Story without subtasks**, or **Subtask**
- Read `docs/stories/$ARGS.md`

**If Subtask:**
- Print error: "Subtasks don't get individual PRs. Run `/create-pr FN-PARENT` on the parent story instead."
- STOP

### 2. Route by Story Type

#### Story WITHOUT subtasks (standard flow)
- Run `git log main..HEAD --oneline` to see commits
- Run `git diff main...HEAD --stat` for changed files summary
- Proceed to step 3

#### Story WITH subtasks (merge flow)
- Verify ALL subtasks are in "Done" status. If any are not Done:
  - Print: "Cannot create PR — these subtasks are not Done: FN-XXX (status), FN-YYY (status)"
  - STOP
- Collect all subtask branch names from Jira comments or story doc
- Create the story-level merge branch and merge subtask branches:
  ```
  git checkout main
  git pull origin main
  git checkout -b <agent>/$ARGS/<slug>
  ```
- For each subtask branch (in dependency order):
  ```
  git merge origin/<subtask-branch> --no-ff -m "Merge FN-XXX: <subtask summary>"
  ```
- If merge conflicts occur, resolve them. If conflicts are complex, STOP and report to user.
- Run `git log main..HEAD --oneline` to see all merged commits
- Run `git diff main...HEAD --stat` for combined changed files summary
- Proceed to step 3

### 3. Rebase on Main (standard flow only)
Skip this step for the merge flow (subtask branches already merged from main-based branches).

For standard flow:
```
git fetch origin main
git rebase origin/main
```
Resolve conflicts if any. If conflicts are complex, STOP and report to user.

### 4. Push Branch
```
git push -u origin HEAD
```

### 5. Create PR
Use `gh pr create` with this format:

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

**Body** (merge flow — add subtask section):
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
- Move the Story to "Code Review" using `transitionJiraIssue`
- Add a Jira comment with the PR URL

### 7. Output
Print:
- PR URL
- Jira key and new status
- Subtask branches merged (if merge flow)
- Next step: `/review-ticket $ARGS`
