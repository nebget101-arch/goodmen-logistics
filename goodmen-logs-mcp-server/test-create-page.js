#!/usr/bin/env node

import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

const baseUrl = process.env.CONFLUENCE_BASE_URL;
const email = process.env.CONFLUENCE_EMAIL;
const apiToken = process.env.CONFLUENCE_API_TOKEN;

console.log('Testing Confluence page creation...');
console.log('Base URL:', baseUrl);
console.log('Space Key: SA');
console.log('');

const client = axios.create({
  baseURL: `${baseUrl}/wiki/rest/api`,
  headers: {
    'Content-Type': 'application/json',
  },
  auth: {
    username: email,
    password: apiToken,
  },
});

// Try to create a test page
const testPage = {
  type: 'page',
  title: 'MCP Test Page - ' + new Date().toISOString(),
  space: {
    key: 'SA',
  },
  body: {
    storage: {
      value: '<h1>Test Page</h1><p>This is a test page created by the MCP server.</p>',
      representation: 'storage',
    },
  },
};

console.log('Creating test page...');
try {
  const response = await client.post('/content', testPage);
  
  console.log('\n✅ Page created successfully!');
  console.log('Page ID:', response.data.id);
  console.log('Page Title:', response.data.title);
  console.log('Page URL:', `${baseUrl}/wiki/spaces/SA/pages/${response.data.id}`);
  
  // Try to get the page we just created
  console.log('\nVerifying page was created...');
  const verifyResponse = await client.get(`/content/${response.data.id}`);
  console.log('✅ Page verified!');
  
} catch (error) {
  console.error('\n❌ Failed to create page!');
  if (error.response) {
    console.error('Status:', error.response.status, error.response.statusText);
    console.error('Error details:', JSON.stringify(error.response.data, null, 2));
  } else {
    console.error('Error:', error.message);
  }
}
