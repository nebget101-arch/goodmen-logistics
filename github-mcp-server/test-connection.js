#!/usr/bin/env node

import dotenv from 'dotenv';
import { Octokit } from '@octokit/rest';

dotenv.config();

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

async function testConnection() {
  try {
    console.log('Testing GitHub connection...\n');
    
    // Test authentication
    const { data: user } = await octokit.users.getAuthenticated();
    console.log('✅ Authentication successful!');
    console.log(`   Logged in as: ${user.login}`);
    console.log(`   Name: ${user.name || 'N/A'}`);
    
    // Test repository access
    const { data: repo } = await octokit.repos.get({
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
    });
    console.log('\n✅ Repository access successful!');
    console.log(`   Repository: ${repo.full_name}`);
    console.log(`   Private: ${repo.private}`);
    
    // Test workflow access
    const { data: workflows } = await octokit.actions.listRepoWorkflows({
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
    });
    console.log('\n✅ Workflow access successful!');
    console.log(`   Found ${workflows.total_count} workflow(s)`);
    workflows.workflows.forEach(wf => {
      console.log(`   - ${wf.name} (${wf.path})`);
    });
    
    console.log('\n🎉 All checks passed! MCP server should work correctly.');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    
    if (error.status === 401) {
      console.error('\n⚠️  Authentication failed!');
      console.error('   - Check that your GITHUB_TOKEN is correct and complete');
      console.error('   - Token should start with "ghp_" for classic tokens');
      console.error('   - Make sure there are no line breaks in the token');
    } else if (error.status === 404) {
      console.error('\n⚠️  Repository not found!');
      console.error('   - Check GITHUB_OWNER and GITHUB_REPO values');
      console.error('   - For private repos, ensure token has "repo" scope');
    } else if (error.status === 403) {
      console.error('\n⚠️  Permission denied!');
      console.error('   - Token needs "repo" and "workflow" scopes');
      console.error('   - Regenerate token with correct permissions');
    }
    
    process.exit(1);
  }
}

testConnection();
