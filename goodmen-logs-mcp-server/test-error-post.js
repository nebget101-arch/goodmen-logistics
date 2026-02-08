#!/usr/bin/env node

import { ConfluenceService } from './build/services/confluence-service.js';
import * as dotenv from 'dotenv';

dotenv.config();

console.log('Testing Confluence error log posting...\n');

// Create sample error log data
const errorLog = `# Goodmen Logistics Error Report
**Date:** ${new Date().toLocaleDateString()}  
**Status:** ⚠️ Errors Detected

## Summary
Critical errors were detected in the Goodmen Logistics backend system.

## Error Details

### Error 1: Database Connection Failed
- **Time:** ${new Date().toISOString()}
- **Level:** ERROR
- **Message:** Failed to connect to database
- **Stack Trace:**
\`\`\`
Error: ECONNREFUSED 127.0.0.1:5432
    at TCPConnectWrap.afterConnect [as oncomplete] (net.js:1148:16)
\`\`\`

### Error 2: API Timeout
- **Time:** ${new Date().toISOString()}
- **Level:** ERROR  
- **Endpoint:** /api/drivers
- **Message:** Request timeout after 30000ms
- **Details:** The request exceeded the maximum timeout duration

## System Information
- **Backend Status:** Running
- **Port:** 3000
- **Node Version:** v18.20.8
- **Total Errors (Last Hour):** 2
- **Critical Issues:** Yes

## Recommended Actions
1. ✅ Check database connection settings
2. ✅ Review API timeout configurations
3. ✅ Monitor system resources
4. ✅ Check network connectivity

---
*Report generated automatically via MCP Server*`;

// Initialize Confluence service
const confluenceService = new ConfluenceService({
  baseUrl: process.env.CONFLUENCE_BASE_URL || '',
  email: process.env.CONFLUENCE_EMAIL || '',
  apiToken: process.env.CONFLUENCE_API_TOKEN || '',
  spaceKey: process.env.CONFLUENCE_SPACE_KEY || '',
});

console.log('Configuration:');
console.log('  Base URL:', process.env.CONFLUENCE_BASE_URL);
console.log('  Email:', process.env.CONFLUENCE_EMAIL);
console.log('  Space Key:', process.env.CONFLUENCE_SPACE_KEY);
console.log('');

// Test posting the error log
try {
  console.log('Posting error log to Confluence...\n');
  
  const result = await confluenceService.postLogs({
    pageTitle: `Goodmen Logistics Error Report - ${new Date().toLocaleString()}`,
    logs: errorLog,
  });

  console.log('✅ Success! Error log posted to Confluence');
  console.log('  Page ID:', result.id);
  console.log('  Page URL:', result.url);
  console.log('\nYou can view the page at:', result.url);

} catch (error) {
  console.error('❌ Failed to post error log to Confluence');
  console.error('Error:', error.message);
  
  if (error.response) {
    console.error('\nAPI Response:');
    console.error('  Status:', error.response.status);
    console.error('  Status Text:', error.response.statusText);
    console.error('  Data:', JSON.stringify(error.response.data, null, 2));
  }
}
