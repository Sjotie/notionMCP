#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🧪 Running Notion MCP Server Tests\n');

const tests = [
  { name: 'Setup Tests', file: 'setup.test.js' },
  { name: 'API Key Tests', file: 'api-keys.test.js' },
  { name: 'Tools Tests', file: 'tools.test.js' },
  { name: 'Express Endpoints Tests', file: 'express-endpoints.test.js' },
  { name: 'Integration Tests', file: 'server-integration.test.js' }
];

let passed = 0;
let failed = 0;

async function runTest(testName, testFile) {
  return new Promise((resolve) => {
    console.log(`Running ${testName}...`);
    
    const testPath = join(__dirname, 'tests', '__tests__', testFile);
    const child = spawn('npm', ['test', '--', testPath], {
      cwd: __dirname,
      stdio: 'pipe',
      shell: true
    });
    
    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      output += data.toString();
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ ${testName} passed\n`);
        passed++;
      } else {
        console.log(`❌ ${testName} failed\n`);
        console.log(output);
        failed++;
      }
      resolve();
    });
  });
}

async function runAllTests() {
  for (const test of tests) {
    await runTest(test.name, test.file);
  }
  
  console.log('\n📊 Test Summary:');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📋 Total: ${tests.length}`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch(console.error);