# Security Guidelines

## 🔐 Sensitive Data Management

This project uses environment variables and secrets to protect sensitive information like API tokens and credentials.

## Files to NEVER Commit

The following files contain sensitive data and should **NEVER** be committed to the repository:

- `.env` files in all directories
- `claude_desktop_config.json` files
- Any files containing API tokens, passwords, or keys

## .gitignore Configuration

All subdirectories have `.gitignore` files that exclude:
```
.env
*.log
.DS_Store
```

## Tokens Used in This Project

### GitHub Personal Access Token
- **Used by**: github-mcp-server, mcp-http-gateway
- **Scopes needed**: `repo`, `workflow`
- **How to get**: GitHub Settings → Developer settings → Personal access tokens → Generate new token

### Confluence API Token
- **Used by**: goodmen-logs-mcp-server, jira-mcp-server, mcp-http-gateway
- **How to get**: Atlassian Account Settings → Security → API tokens → Create API token

### Jira API Token
- **Used by**: jira-mcp-server, mcp-http-gateway
- **How to get**: Same as Confluence (uses Atlassian API token)

## Local Development Setup

1. **Copy example files**:
   ```bash
   cp mcp-http-gateway/.env.example mcp-http-gateway/.env
   cp github-mcp-server/.env.example github-mcp-server/.env
   cp jira-mcp-server/.env.example jira-mcp-server/.env
   ```

2. **Fill in your tokens**:
   Edit each `.env` file and replace placeholders with your actual tokens

3. **Never commit .env files**:
   Double-check before committing:
   ```bash
   git status
   # Ensure .env files are not listed
   ```

## Render Deployment Configuration

### Configure Secrets in Render Dashboard

1. Go to https://dashboard.render.com/
2. Select your service
3. Navigate to **Environment** tab
4. Add each secret individually:

**For mcp-http-gateway service:**

| Variable Name | Type | How to Set |
|--------------|------|------------|
| `GITHUB_TOKEN` | Secret | Add as environment variable, mark as secret |
| `CONFLUENCE_API_TOKEN` | Secret | Add as environment variable, mark as secret |
| `CONFLUENCE_EMAIL` | Secret | Add as environment variable, mark as secret |
| `JIRA_API_TOKEN` | Secret | Add as environment variable, mark as secret |
| `JIRA_EMAIL` | Secret | Add as environment variable, mark as secret |
| `GITHUB_OWNER` | Public | Defined in render.yaml |
| `GITHUB_REPO` | Public | Defined in render.yaml |
| `CONFLUENCE_BASE_URL` | Public | Defined in render.yaml |
| `JIRA_BASE_URL` | Public | Defined in render.yaml |

### Verify render.yaml Security

The `render.yaml` uses `sync: false` for all sensitive variables:
```yaml
envVars:
  - key: GITHUB_TOKEN
    sync: false  # ✅ Must be configured in Render dashboard
  - key: CONFLUENCE_API_TOKEN
    sync: false  # ✅ Must be configured in Render dashboard
```

## Security Checklist Before Deployment

- [ ] All `.env` files are in `.gitignore`
- [ ] No tokens in `render.yaml` (only `sync: false`)
- [ ] No tokens in `.env.example` files
- [ ] No tokens in Claude config files (removed from repo)
- [ ] Secrets configured in Render dashboard
- [ ] Repository is public but secrets are in Render only
- [ ] No tokens in git history (if leaked, rotate them immediately)

## Token Rotation

If a token is compromised:

1. **Immediately revoke** the old token in the service (GitHub/Atlassian)
2. **Generate a new token** with the same scopes
3. **Update Render environment variables** with new token
4. **Redeploy** the service (Render will use new token)
5. **Update local `.env`** files for development

## Audit

To check for accidentally committed secrets:

```bash
# Check current files
git ls-files | grep -E '\\.env$'
# Should return nothing

# Check for token patterns in git history (be careful!)
git log -p | grep -i "token"
```

## Emergency: Token Leaked in Git History

If you accidentally committed a token:

1. **Immediately revoke the token** in GitHub/Atlassian
2. **Generate a new token**
3. **Remove from git history**:
   ```bash
   # Use git filter-branch or BFG Repo-Cleaner
   # Consult: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository
   ```
4. **Force push** (⚠️ coordinate with team)
5. **Verify** the token is gone from all branches

## Best Practices

✅ **DO**:
- Use `.env` files for local development
- Use Render environment variables for production
- Use `sync: false` in render.yaml for secrets
- Rotate tokens periodically (every 90 days)
- Use fine-grained tokens with minimal scopes
- Keep `.env.example` files updated (without real values)

❌ **DON'T**:
- Commit `.env` files
- Put tokens in render.yaml
- Share tokens in Slack/email
- Use the same token across multiple services
- Store tokens in code comments
- Push tokens to public repositories

## Questions?

If you find a security issue, report it immediately to the project maintainer.
