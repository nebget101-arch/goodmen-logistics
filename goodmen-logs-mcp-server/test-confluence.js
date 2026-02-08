#!/usr/bin/env node

import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

const baseUrl = process.env.CONFLUENCE_BASE_URL;
const email = process.env.CONFLUENCE_EMAIL;
const apiToken = process.env.CONFLUENCE_API_TOKEN;

console.log('Testing Confluence connection...');
console.log('Base URL:', baseUrl);
console.log('Email:', email);
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

// Test 1: Get all spaces
console.log('Fetching all accessible spaces...');
try {
  const response = await client.get('/space');
  
  console.log('\n✅ Connection successful!');
  console.log('\nYour accessible spaces:');
  console.log('========================');
  
  response.data.results.forEach(space => {
    console.log(`\nSpace Name: ${space.name}`);
    console.log(`Space Key: ${space.key}`);
    console.log(`Space Type: ${space.type}`);
    console.log(`URL: ${baseUrl}/wiki/spaces/${space.key}`);
  });

  // Test 2: Try to get content from SAFETYAPP space
  console.log('\n\nTesting SAFETYAPP space...');
  try {
    const spaceResponse = await client.get('/space/SAFETYAPP');
    console.log('✅ SAFETYAPP space exists!');
    console.log('Space ID:', spaceResponse.data.id);
    console.log('Space Name:', spaceResponse.data.name);
  } catch (error) {
    console.log('❌ SAFETYAPP space not found');
    if (error.response) {
      console.log('Error:', error.response.status, error.response.statusText);
    }
  }

} catch (error) {
  console.error('\n❌ Connection failed!');
  if (error.response) {
    console.error('Status:', error.response.status);
    console.error('Error:', error.response.data);
  } else {
    console.error('Error:', error.message);
  }
}
