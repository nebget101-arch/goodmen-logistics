#!/usr/bin/env node

import dotenv from 'dotenv';
import { Octokit } from '@octokit/rest';

dotenv.config();

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

async function listRepos() {
  try {
    console.log('Fetching your repositories...\n');
    
    const { data: repos } = await octokit.repos.listForAuthenticatedUser({
      per_page: 100,
      sort: 'updated',
    });
    
    console.log(`Found ${repos.length} repositories:\n`);
    
    repos.forEach((repo, index) => {
      console.log(`${index + 1}. ${repo.full_name}`);
      console.log(`   Private: ${repo.private}`);
      console.log(`   Updated: ${new Date(repo.updated_at).toLocaleDateString()}`);
      if (repo.name.toLowerCase().includes('safety') || repo.name.toLowerCase().includes('goodmen')) {
        console.log('   ⭐ POTENTIAL MATCH!');
      }
      console.log('');
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

listRepos();
