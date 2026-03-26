---
name: review-ticket
description: Code Reviewer validates PR against requirements, acceptance criteria, architecture, docs, and deployment notes.
user_invocable: true
args: "<jira-key>"
---

# /review-ticket — Code Review

Perform a structured code review for the specified ticket.

## Input
The argument is the Jira key (e.g., `FN-42`).

## Steps

### 1. Gather Context
- Fetch the Jira issue with `getJiraIssue` for `$ARGS`
- Read `docs/stories/$ARGS.md`
- Find the PR: `gh pr list --search "$ARGS"`
- Read the PR diff: `gh pr diff <number>`

### 2. Review Checklist
Evaluate each item:

**Requirements Match**
- Does the code implement what the Jira ticket describes?
- Are all acceptance criteria addressed in the implementation?

**Scope**
- Are changes limited to what the story requires?
- No unrelated refactoring or feature additions?

**Documentation**
- Is `docs/stories/$ARGS.md` updated with implementation details?
- Are key decisions documented?

**Architecture**
- Do changes follow existing codebase patterns?
- Are new patterns justified?

**Tests**
- Are tests written for the changes?
- Do tests cover the acceptance criteria?

**Security**
- No hardcoded secrets or credentials?
- No injection vulnerabilities (SQL, XSS, command)?
- Input validation at boundaries?

**Regression Risk**
- Could changes break existing functionality?
- Are shared modules affected?

**Deployment Notes (REQUIRED)**
- Are deployment/restart notes present and complete?
- Services to restart listed?
- Migrations documented?
- Env/config changes specified?
- Post-deploy verification steps included?

### 3. Output Structured Review
```markdown
## Code Review: $ARGS

### Coverage
- [x/] Requirements match
- [x/] All AC items addressed
- [x/] Scope appropriate
- [x/] Story doc updated
- [x/] Tests adequate
- [x/] Security reviewed
- [x/] Deployment notes complete

### Issues Found
1. [severity] Description — file:line

### Risks
- Risk description and mitigation

### Recommendation
APPROVE / REQUEST CHANGES / BLOCK

### Notes
Additional observations
```

### 4. Update Story Doc
Add review findings to `docs/stories/$ARGS.md` under **Review Findings**.

### 5. Next Steps
- If APPROVE: Tell user next step is `/handoff-qa $ARGS`
- If REQUEST CHANGES: List specific changes needed, ticket stays in "Code Review"
- If BLOCK: Explain blocking reason
