# Git Workflow Quick Reference

## Daily Commands for AI Agents

### Starting Work on a New Feature

```bash
# 1. Switch to develop and get latest
git checkout develop
git pull origin develop

# 2. Create feature branch (use your prefix)
# Backend AI:
git checkout -b backend/feature-name

# UI/UX AI:
git checkout -b frontend/feature-name

# iOS AI:
git checkout -b ios/feature-name

# Android AI:
git checkout -b android/feature-name

# 3. Work on your files, commit often
git add path/to/file.js
git commit -m "feat(backend): Add endpoint for X"

# 4. Push to remote
git push origin backend/feature-name
```

### Syncing with Latest Develop

```bash
# While on your feature branch
git fetch origin
git merge origin/develop

# Or use rebase for cleaner history
git rebase origin/develop

# Resolve conflicts if any, then
git add .
git commit -m "merge: Sync with latest develop"
git push origin backend/feature-name
```

### Creating a Pull Request

```bash
# 1. Ensure all changes are committed and pushed
git status
git push origin backend/feature-name

# 2. Go to GitHub and create PR
# - Base branch: develop
# - Compare branch: backend/feature-name
# - Title: "[Backend] Feature Name"
# - Description: What, why, testing notes

# 3. Request review from team
```

### Handling Merge Conflicts

```bash
# Conflicts detected during merge/rebase
git status  # See conflicted files

# Edit conflicted files (look for <<<<<<, ======, >>>>>>)
# Choose which changes to keep

# Mark as resolved
git add conflicted-file.js

# Continue merge/rebase
git commit  # For merge
git rebase --continue  # For rebase

# Push
git push origin backend/feature-name
```

### Working on Integration Branch

```bash
# For features requiring multiple agents

# Backend AI creates integration branch
git checkout develop
git pull origin develop
git checkout -b integration/full-feature-name

# Merge your feature
git merge backend/sub-feature --no-ff

# Push
git push origin integration/full-feature-name

# UI/UX AI merges their feature
git checkout integration/full-feature-name
git merge frontend/sub-feature --no-ff
git push origin integration/full-feature-name

# All agents test together
# Fix issues, commit, push
# Create PR: integration/full-feature-name → develop
```

---

## Commit Message Templates

### Feature Addition
```bash
git commit -m "feat(backend/logistics): Add POST /api/settlements endpoint

- Accepts driver_id, start_date, end_date
- Calculates total pay from loads
- Returns settlement summary JSON
- Added tests for edge cases"
```

### Bug Fix
```bash
git commit -m "fix(frontend/settlements): Correct date range filter

- Fixed off-by-one error in date calculation
- Now includes end_date in range
- Closes #123"
```

### Documentation
```bash
git commit -m "docs(shared): Update RBAC.md with settlement permissions

- Added settlements.view, settlements.approve
- Added example usage in routes
- Updated permission table"
```

### Refactor
```bash
git commit -m "refactor(backend/shared): Extract settlement calculation to service

- Moved logic from routes to services/settlement-calculator.js
- Added unit tests
- No API changes"
```

### Database Migration
```bash
git commit -m "feat(database): Add settlement tables migration

- Tables: settlements, settlement_load_items, etc.
- Foreign keys to drivers, loads, payroll_periods
- Indexes on driver_id, period_id"
```

---

## Branch Naming Examples

### Backend AI
- `backend/payroll-settlement-api`
- `backend/load-mileage-calculation`
- `backend/email-notification-service`
- `backend/fix-hos-date-validation`

### Frontend AI
- `frontend/settlement-dashboard`
- `frontend/work-order-form-refactor`
- `frontend/mobile-responsive-navbar`
- `frontend/fix-login-redirect`

### iOS AI
- `ios/push-notifications`
- `ios/offline-load-sync`
- `ios/camera-document-upload`
- `ios/fix-load-detail-crash`

### Android AI
- `android/initial-project-setup`
- `android/load-list-view`
- `android/biometric-auth`
- `android/fix-network-timeout`

### Shared
- `shared/settlement-schema-migration`
- `shared/rbac-permission-updates`
- `shared/upgrade-node-18`

---

## Status Check Commands

```bash
# See current branch and uncommitted changes
git status

# See commit history
git log --oneline --graph --decorate --all

# See what changed in a file
git diff path/to/file.js

# See what changed between branches
git diff develop..backend/feature-name

# See which files differ from develop
git diff --name-only develop..backend/feature-name

# Check if branch is up to date with develop
git fetch origin
git log develop..origin/develop  # Should be empty if up to date
```

---

## Cleanup Commands

```bash
# Delete local branch after merge
git branch -d backend/feature-name

# Force delete if not merged (be careful!)
git branch -D backend/old-experiment

# Delete remote branch after merge
git push origin --delete backend/feature-name

# Prune deleted remote branches from local
git fetch --prune
```

---

## Emergency Commands

### Undo Last Commit (Not Pushed)
```bash
# Keep changes, undo commit
git reset --soft HEAD~1

# Discard changes, undo commit
git reset --hard HEAD~1
```

### Undo Pushed Commit
```bash
# Create reverse commit
git revert HEAD
git push origin backend/feature-name
```

### Stash Changes Temporarily
```bash
# Save work in progress
git stash

# Switch branches, do other work

# Come back and restore
git stash pop
```

### Discard All Local Changes
```bash
# Throw away all uncommitted changes
git reset --hard HEAD

# Remove untracked files too
git clean -fd
```

---

## Release Workflow (Backend AI Lead)

```bash
# 1. Create release branch from develop
git checkout develop
git pull origin develop
git checkout -b release/v1.5.0

# 2. Bump version in package.json files
# Edit: backend/gateway/package.json, backend/microservices/*/package.json, frontend/package.json
# Change "version": "1.4.0" to "version": "1.5.0"

# 3. Update CHANGELOG.md
# Add release notes

# 4. Commit
git add .
git commit -m "chore: Bump version to 1.5.0 and update changelog"
git push origin release/v1.5.0

# 5. Test on staging (Render deploys release branch)

# 6. Merge to main
git checkout main
git merge release/v1.5.0 --no-ff
git tag v1.5.0
git push origin main --tags

# 7. Merge back to develop
git checkout develop
git merge release/v1.5.0 --no-ff
git push origin develop

# 8. Delete release branch
git branch -d release/v1.5.0
git push origin --delete release/v1.5.0
```

---

## Collaboration Scenarios

### Scenario 1: Backend finishes API, Frontend needs it

**Backend AI:**
```bash
# 1. Merge feature to develop
git checkout develop
git merge backend/payroll-api --no-ff
git push origin develop

# 2. Notify team in /docs/TEAM-STATUS-DAILY.md
```

**Frontend AI:**
```bash
# 1. Update your branch with latest develop
git checkout frontend/settlement-dashboard
git merge develop

# 2. Now you have the API, implement UI
# 3. Push your work
git push origin frontend/settlement-dashboard
```

### Scenario 2: Database migration needed

**Backend AI:**
```bash
# 1. Create migration branch
git checkout -b shared/add-settlement-tables develop

# 2. Create migration
cd backend/packages/goodmen-database
npx knex migrate:make add_settlement_tables

# 3. Edit migration file, commit
git add migrations/20260308000000_add_settlement_tables.js
git commit -m "feat(database): Add settlement tables"
git push origin shared/add-settlement-tables

# 4. Create PR, notify ALL agents to review
# 5. After merge, notify team to run migration locally
```

**All Other Agents:**
```bash
# After migration merged to develop
git checkout develop
git pull origin develop

# Run migration
cd backend/packages/goodmen-database
npx knex migrate:latest

# Verify
npx knex migrate:status

# Now update your code to use new tables
```

### Scenario 3: Merge conflict on develop

**Agent who created conflict:**
```bash
# Pull latest develop
git checkout develop
git pull origin develop
# Error: Merge conflict in docs/TEAM-STATUS-DAILY.md

# Open file, resolve conflict (keep both updates usually)
# Edit docs/TEAM-STATUS-DAILY.md

# Stage resolved file
git add docs/TEAM-STATUS-DAILY.md
git commit -m "merge: Resolve conflict in team status doc"
git push origin develop
```

---

## Best Practices

✅ **DO:**
- Commit often (multiple times per day)
- Write descriptive commit messages
- Push to remote daily
- Pull from develop before starting new work
- Test locally before pushing
- Keep branches short-lived (< 1 week)

❌ **DON'T:**
- Commit directly to `main` or `develop`
- Force push to shared branches
- Edit other agent's files without coordination
- Merge without testing
- Leave branches stale for weeks

---

## Aliases (Optional, Add to ~/.gitconfig)

```ini
[alias]
    st = status
    co = checkout
    br = branch
    ci = commit
    cm = commit -m
    aa = add --all
    lg = log --oneline --graph --decorate --all
    sync = !git fetch origin && git merge origin/develop
    cleanup = !git fetch --prune && git branch -vv | grep ': gone]' | awk '{print $1}' | xargs git branch -D
```

Usage:
```bash
git st                           # git status
git co develop                   # git checkout develop
git cm "feat: Add feature"       # git commit -m "feat: Add feature"
git lg                           # Pretty log
git sync                         # Sync with develop
git cleanup                      # Remove stale branches
```

---

**Last Updated:** March 8, 2026  
**For Questions:** See `/docs/BACKEND-ANALYSIS-AND-COLLABORATION-STRATEGY.md`
