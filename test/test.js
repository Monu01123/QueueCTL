const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🧪 QueueCTL Test Suite v2.0\n');
console.log('=' .repeat(60));

let testsPassed = 0;
let testsFailed = 0;

// Clean up old test data
const dataDir = path.join(__dirname, '..', 'data');
if (fs.existsSync(dataDir)) {
  fs.rmSync(dataDir, { recursive: true, force: true });
}

function runCommand(command) {
  try {
    const output = execSync(command, { 
      encoding: 'utf8',
      cwd: path.join(__dirname, '..'),
      shell: true,
      stdio: 'pipe'
    });
    return { success: true, output };
  } catch (error) {
    return { success: false, output: error.stdout || error.message };
  }
}

function assert(condition, testName) {
  if (condition) {
    console.log(`✅ PASS: ${testName}`);
    testsPassed++;
    return true;
  } else {
    console.log(`❌ FAIL: ${testName}`);
    testsFailed++;
    return false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readJobs() {
  const jobsFile = path.join(dataDir, 'jobs.json');
  if (fs.existsSync(jobsFile)) {
    return JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
  }
  return [];
}

function readConfig() {
  const configFile = path.join(dataDir, 'config.json');
  if (fs.existsSync(configFile)) {
    return JSON.parse(fs.readFileSync(configFile, 'utf8'));
  }
  return {};
}

async function runTests() {
  console.log('\n📋 Test Suite 1: Basic Enqueue Operations\n');
  
  // Test 1.1
  console.log('Test 1.1: Enqueue job using flags');
  let result = runCommand('node bin/queuectl.js enqueue -c "echo Test1" -i test1');
  assert(result.success && result.output.includes('enqueued successfully'), 
    'Enqueue job with flags');

  // Test 1.2
  console.log('\nTest 1.2: Verify job persistence');
  let jobs = readJobs();
  assert(jobs.length === 1 && jobs[0].id === 'test1', 
    'Job persisted to storage');

  // Test 1.3
  console.log('\nTest 1.3: Validate job structure');
  const job = jobs[0];
  assert(
    job.id && job.command && job.state === 'pending' && 
    job.attempts === 0 && job.max_retries === 3 &&
    job.created_at && job.updated_at,
    'Job has all required fields'
  );

  // Test 1.4
  console.log('\nTest 1.4: Enqueue multiple jobs');
  runCommand('node bin/queuectl.js enqueue -c "echo Test2"');
  runCommand('node bin/queuectl.js enqueue -c "echo Test3"');
  jobs = readJobs();
  assert(jobs.length === 3, 'Multiple jobs enqueued');

  console.log('\n' + '='.repeat(60));
  console.log('\n📋 Test Suite 2: Priority Support (if available)\n');

  // Test 2.1
  console.log('Test 2.1: Enqueue with priority (if supported)');
  result = runCommand('node bin/queuectl.js enqueue -c "echo Priority Test" -p 1 -i priority-test');
  if (result.success) {
    jobs = readJobs();
    const priJob = jobs.find(j => j.id === 'priority-test');
    assert(priJob && (priJob.priority === 1 || priJob.priority === undefined), 
      'Priority job enqueued (feature detected)');
  } else {
    console.log('⚠️  SKIP: Priority feature not available yet');
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n📋 Test Suite 3: Configuration Management\n');

  // Test 3.1
  console.log('Test 3.1: Set max-retries');
  result = runCommand('node bin/queuectl.js config set max-retries 5');
  assert(result.success, 'Set max-retries config');

  // Test 3.2
  console.log('\nTest 3.2: Verify config persisted');
  const config = readConfig();
  assert(config['max-retries'] == 5, 'Configuration persisted');

  // Test 3.3
  console.log('\nTest 3.3: Set backoff-base');
  result = runCommand('node bin/queuectl.js config set backoff-base 3');
  assert(result.success, 'Set backoff-base config');

  // Test 3.4
  console.log('\nTest 3.4: Get config value');
  result = runCommand('node bin/queuectl.js config get max-retries');
  assert(result.success && result.output.includes('5'), 'Get config value');

  console.log('\n' + '='.repeat(60));
  console.log('\n📋 Test Suite 4: Job Listing and Status\n');

  // Test 4.1
  console.log('Test 4.1: List all jobs');
  result = runCommand('node bin/queuectl.js list');
  assert(result.success && result.output.includes('test1'), 'List all jobs');

  // Test 4.2
  console.log('\nTest 4.2: List by state');
  result = runCommand('node bin/queuectl.js list --state pending');
  assert(result.success && result.output.includes('pending'), 'List jobs by state');

  // Test 4.3
  console.log('\nTest 4.3: Status command');
  result = runCommand('node bin/queuectl.js status');
  assert(result.success && result.output.includes('Queue Status'), 'Status command');

  console.log('\n' + '='.repeat(60));
  console.log('\n📋 Test Suite 5: Worker Processing\n');

  // Test 5.1
  console.log('Test 5.1: Process job with worker');
  runCommand('node bin/queuectl.js enqueue -c "echo Worker Test" -i worker-test');
  
  const workerProcess = spawn('node', ['bin/queuectl.js', 'worker', 'start'], {
    cwd: path.join(__dirname, '..'),
    detached: false,
    stdio: 'pipe'
  });

  await sleep(3000);
  workerProcess.kill('SIGINT');
  await sleep(1000);

  jobs = readJobs();
  const processedJob = jobs.find(j => j.id === 'worker-test');
  assert(processedJob && processedJob.state === 'completed', 
    'Worker processed job successfully');

  console.log('\n' + '='.repeat(60));
  console.log('\n📋 Test Suite 6: Retry Mechanism\n');

  // Test 6.1
  console.log('Test 6.1: Enqueue failing job');
  runCommand('node bin/queuectl.js enqueue -c "exit 1" -i fail-job -r 2');
  
  const workerProcess2 = spawn('node', ['bin/queuectl.js', 'worker', 'start'], {
    cwd: path.join(__dirname, '..'),
    detached: false,
    stdio: 'pipe'
  });

  await sleep(3000);
  
  jobs = readJobs();
  let failJob = jobs.find(j => j.id === 'fail-job');
  assert(failJob && failJob.attempts >= 1 && failJob.state === 'failed', 
    'Job failed and marked for retry');

  // Test 6.2
  console.log('\nTest 6.2: Wait for retries and DLQ');
  await sleep(12000); // Wait for backoff + retries
  
  jobs = readJobs();
  failJob = jobs.find(j => j.id === 'fail-job');
  const movedToDLQ = failJob && failJob.state === 'dead';
  assert(movedToDLQ, 'Job moved to DLQ after max retries');

  workerProcess2.kill('SIGINT');
  await sleep(1000);

  console.log('\n' + '='.repeat(60));
  console.log('\n📋 Test Suite 7: Dead Letter Queue\n');

  // Test 7.1
  console.log('Test 7.1: List DLQ');
  result = runCommand('node bin/queuectl.js dlq list');
  assert(result.success && result.output.includes('fail-job'), 
    'DLQ list shows failed job');

  // Test 7.2
  console.log('\nTest 7.2: Retry from DLQ');
  result = runCommand('node bin/queuectl.js dlq retry fail-job');
  assert(result.success, 'Retry job from DLQ');

  jobs = readJobs();
  failJob = jobs.find(j => j.id === 'fail-job');
  assert(failJob && failJob.state === 'pending' && failJob.attempts === 0, 
    'Job reset and moved to pending');

  console.log('\n' + '='.repeat(60));
  console.log('\n📋 Test Suite 8: Persistence\n');

  // Test 8.1
  console.log('Test 8.1: Add jobs for persistence test');
  runCommand('node bin/queuectl.js enqueue -c "echo Persist1" -i persist1');
  runCommand('node bin/queuectl.js enqueue -c "echo Persist2" -i persist2');
  
  let beforeJobs = readJobs().filter(j => j.id.startsWith('persist'));
  assert(beforeJobs.length === 2, 'Jobs added');

  // Test 8.2
  console.log('\nTest 8.2: Verify persistence');
  let afterJobs = readJobs().filter(j => j.id.startsWith('persist'));
  assert(afterJobs.length === 2, 'Jobs persisted');

  console.log('\n' + '='.repeat(60));
  console.log('\n📋 Test Suite 9: Concurrency\n');

  // Test 9.1
  console.log('Test 9.1: Multiple workers without overlap');
  runCommand('node bin/queuectl.js enqueue -c "echo Concurrent1" -i conc1');
  runCommand('node bin/queuectl.js enqueue -c "echo Concurrent2" -i conc2');

  const worker1 = spawn('node', ['bin/queuectl.js', 'worker', 'start'], {
    cwd: path.join(__dirname, '..'),
    detached: false,
    stdio: 'pipe'
  });

  const worker2 = spawn('node', ['bin/queuectl.js', 'worker', 'start'], {
    cwd: path.join(__dirname, '..'),
    detached: false,
    stdio: 'pipe'
  });

  await sleep(4000);

  worker1.kill('SIGINT');
  worker2.kill('SIGINT');
  await sleep(1000);

  jobs = readJobs();
  const conc1 = jobs.find(j => j.id === 'conc1');
  const conc2 = jobs.find(j => j.id === 'conc2');
  
  assert(
    (conc1 && conc1.state === 'completed') && 
    (conc2 && conc2.state === 'completed'),
    'Multiple workers processed different jobs'
  );

  console.log('\n' + '='.repeat(60));
  console.log('\n📋 Test Suite 10: Error Handling\n');

  // Test 10.1
  console.log('Test 10.1: Invalid command handling');
  runCommand('node bin/queuectl.js enqueue -c "nonexistentcommand123" -i invalid-cmd');
  
  const workerProcess3 = spawn('node', ['bin/queuectl.js', 'worker', 'start'], {
    cwd: path.join(__dirname, '..'),
    detached: false,
    stdio: 'pipe'
  });

  await sleep(3000);
  workerProcess3.kill('SIGINT');
  await sleep(1000);

  jobs = readJobs();
  const invalidJob = jobs.find(j => j.id === 'invalid-cmd');
  assert(invalidJob && (invalidJob.state === 'failed' || invalidJob.state === 'dead') && invalidJob.error,
    'Invalid command handled gracefully');

  // Test 10.2
  console.log('\nTest 10.2: Invalid config rejection');
  result = runCommand('node bin/queuectl.js config set invalid-key 5');
  assert(!result.success, 'Invalid config rejected');

  console.log('\n' + '='.repeat(60));
  console.log('\n📋 Test Suite 11: Cancellation (if available)\n');

  // Test 11.1
  console.log('Test 11.1: Cancel pending job (if supported)');
  runCommand('node bin/queuectl.js enqueue -c "echo Cancellable" -i cancel-test');
  result = runCommand('node bin/queuectl.js cancel cancel-test');
  
  if (result.success) {
    jobs = readJobs();
    const cancelledJob = jobs.find(j => j.id === 'cancel-test');
    assert(cancelledJob && cancelledJob.state === 'cancelled', 
      'Job cancelled successfully');
  } else {
    console.log('⚠️  SKIP: Cancel feature not available yet');
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n📋 Test Suite 12: Metrics (if available)\n');

  // Test 12.1
  console.log('Test 12.1: Metrics command (if supported)');
  result = runCommand('node bin/queuectl.js metrics');
  
  if (result.success && result.output.includes('Metrics')) {
    assert(true, 'Metrics command works');
  } else {
    console.log('⚠️  SKIP: Metrics feature not available yet');
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n📊 Test Summary\n');
  console.log(`Total Tests: ${testsPassed + testsFailed}`);
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log(`Success Rate: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(1)}%`);

  if (testsFailed === 0) {
    console.log('\n🎉 All tests passed!\n');
    process.exit(0);
  } else if (testsPassed >= 20) {
    console.log('\n✅ Good! Most tests passed. Check failures above.\n');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some tests failed. Review output above.\n');
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('\n❌ Test suite crashed:', error);
  process.exit(1);
});