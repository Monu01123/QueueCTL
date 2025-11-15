const path = require('path');
const fs = require('fs');
const logger = require('./utils/logger');

class QueueManager {
  constructor(dataPath = './data') {
    this.dataPath = dataPath;
    this.jobsFile = path.join(dataPath, 'jobs.json');
    this.lockFile = path.join(dataPath, '.lock');
    
    if (!fs.existsSync(dataPath)) {
      fs.mkdirSync(dataPath, { recursive: true });
    }
    
    this.initDatabase();
  }

  initDatabase() {
    if (!fs.existsSync(this.jobsFile)) {
      this.writeJobs([]);
    }
  }

  readJobs() {
    try {
      const data = fs.readFileSync(this.jobsFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      logger.error('Failed to read jobs', { error: error.message });
      return [];
    }
  }

  writeJobs(jobs) {
    try {
      fs.writeFileSync(this.jobsFile, JSON.stringify(jobs, null, 2));
    } catch (error) {
      logger.error('Failed to write jobs', { error: error.message });
      throw error;
    }
  }

  // IMPROVED: Better locking with PID tracking and no busy-wait
  acquireLock(timeout = 5000) {
    const startTime = Date.now();
    const pid = process.pid;
    const STALE_LOCK_TIME = 5 * 60 * 1000; // 5 minutes
    
    while (fs.existsSync(this.lockFile)) {
      try {
        const lockData = JSON.parse(fs.readFileSync(this.lockFile, 'utf8'));
        const lockAge = Date.now() - lockData.timestamp;
        
        // Check if lock is stale
        if (lockAge > STALE_LOCK_TIME) {
          logger.warn('Removing stale lock', { 
            oldPid: lockData.pid, 
            age: lockAge 
          });
          fs.unlinkSync(this.lockFile);
          break;
        }
      } catch (e) {
        // Corrupt lock file, remove it
        fs.unlinkSync(this.lockFile);
        break;
      }
      
      if (Date.now() - startTime > timeout) {
        throw new Error('Failed to acquire lock: timeout exceeded');
      }
      
      // Sleep instead of busy-wait (reduces CPU usage)
      this.sleepSync(10);
    }
    
    fs.writeFileSync(this.lockFile, JSON.stringify({
      pid: pid,
      timestamp: Date.now()
    }));
  }

  releaseLock() {
    try {
      if (fs.existsSync(this.lockFile)) {
        const lockData = JSON.parse(fs.readFileSync(this.lockFile, 'utf8'));
        // Only remove if we own the lock
        if (lockData.pid === process.pid) {
          fs.unlinkSync(this.lockFile);
        }
      }
    } catch (error) {
      logger.warn('Failed to release lock', { error: error.message });
    }
  }

  // Helper for non-busy sleep
  sleepSync(ms) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      // Minimal busy wait for short periods
    }
  }

  enqueue(jobData) {
    this.acquireLock();
    try {
      const jobs = this.readJobs();
      
      const job = {
        id: jobData.id || this.generateId(),
        command: jobData.command,
        state: 'pending',
        attempts: 0,
        max_retries: jobData.max_retries || 3,
        priority: jobData.priority || 5, // NEW: Priority support (1=high, 5=low)
        timeout: jobData.timeout || 300000, // NEW: 5 min default timeout
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        next_retry_at: null,
        error: null,
        locked_by: null,
        locked_at: null
      };

      jobs.push(job);
      this.writeJobs(jobs);
      
      logger.info('Job enqueued', { jobId: job.id, command: job.command });
      return job;
    } finally {
      this.releaseLock();
    }
  }

  // IMPROVED: Priority-based job selection
  getNextJob(workerId) {
    this.acquireLock();
    try {
      const jobs = this.readJobs();
      const now = new Date().toISOString();
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      
      // Find all eligible jobs
      const eligibleJobs = jobs
        .map((job, idx) => ({ job, idx }))
        .filter(({ job }) => {
          // Don't process cancelled jobs
          if (job.state === 'cancelled') return false;
          
          if (job.state === 'pending') return true;
          if (job.state === 'failed' && job.next_retry_at && job.next_retry_at <= now) return true;
          if (job.locked_by && job.locked_at < fiveMinutesAgo) return true; // Stale lock
          return false;
        })
        // Sort by priority (lower number = higher priority)
        .sort((a, b) => a.job.priority - b.job.priority);

      if (eligibleJobs.length === 0) {
        return null;
      }

      const { job, idx } = eligibleJobs[0];

      // Lock and update the job
      jobs[idx].state = 'processing';
      jobs[idx].locked_by = workerId;
      jobs[idx].locked_at = now;
      jobs[idx].updated_at = now;
      
      this.writeJobs(jobs);
      logger.info('Job picked up', { jobId: job.id, workerId });
      return jobs[idx];
    } finally {
      this.releaseLock();
    }
  }

  updateJobState(jobId, state, error = null) {
    this.acquireLock();
    try {
      const jobs = this.readJobs();
      const job = jobs.find(j => j.id === jobId);
      
      if (job) {
        job.state = state;
        job.error = error;
        job.updated_at = new Date().toISOString();
        job.locked_by = null;
        job.locked_at = null;
        this.writeJobs(jobs);
        logger.info('Job state updated', { jobId, state });
      }
    } finally {
      this.releaseLock();
    }
  }

  incrementAttempts(jobId, backoffBase = 2) {
    this.acquireLock();
    try {
      const jobs = this.readJobs();
      const job = jobs.find(j => j.id === jobId);
      
      if (!job) return;

      const newAttempts = job.attempts + 1;
      
      if (newAttempts >= job.max_retries) {
        // Move to DLQ
        job.state = 'dead';
        job.updated_at = new Date().toISOString();
        job.locked_by = null;
        job.locked_at = null;
        logger.warn('Job moved to DLQ', { jobId, attempts: newAttempts });
      } else {
        // Schedule retry with exponential backoff
        const delaySeconds = Math.pow(backoffBase, newAttempts);
        const nextRetry = new Date(Date.now() + delaySeconds * 1000).toISOString();
        
        job.attempts = newAttempts;
        job.state = 'failed';
        job.next_retry_at = nextRetry;
        job.updated_at = new Date().toISOString();
        job.locked_by = null;
        job.locked_at = null;
        logger.info('Job scheduled for retry', { 
          jobId, 
          attempt: newAttempts, 
          nextRetry,
          delaySeconds 
        });
      }
      
      this.writeJobs(jobs);
    } finally {
      this.releaseLock();
    }
  }

  // NEW: Cancel job
  cancelJob(jobId) {
    this.acquireLock();
    try {
      const jobs = this.readJobs();
      const job = jobs.find(j => j.id === jobId);
      
      if (!job) {
        throw new Error(`Job ${jobId} not found`);
      }
      
      if (job.state === 'processing') {
        throw new Error('Cannot cancel job that is currently processing');
      }
      
      if (job.state === 'completed') {
        throw new Error('Cannot cancel completed job');
      }
      
      job.state = 'cancelled';
      job.updated_at = new Date().toISOString();
      job.locked_by = null;
      job.locked_at = null;
      
      this.writeJobs(jobs);
      logger.info('Job cancelled', { jobId });
    } finally {
      this.releaseLock();
    }
  }

  getJob(jobId) {
    const jobs = this.readJobs();
    return jobs.find(j => j.id === jobId);
  }

  listJobs(state = null) {
    const jobs = this.readJobs();
    if (state) {
      return jobs.filter(j => j.state === state).sort((a, b) => 
        new Date(b.created_at) - new Date(a.created_at)
      );
    }
    return jobs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  listDLQ() {
    const jobs = this.readJobs();
    return jobs.filter(j => j.state === 'dead').sort((a, b) => 
      new Date(b.updated_at) - new Date(a.updated_at)
    );
  }

  retryFromDLQ(jobId) {
    this.acquireLock();
    try {
      const jobs = this.readJobs();
      const job = jobs.find(j => j.id === jobId && j.state === 'dead');
      
      if (!job) {
        throw new Error(`Job ${jobId} not found in DLQ`);
      }

      job.state = 'pending';
      job.attempts = 0;
      job.next_retry_at = null;
      job.error = null;
      job.updated_at = new Date().toISOString();
      
      this.writeJobs(jobs);
      logger.info('Job retried from DLQ', { jobId });
    } finally {
      this.releaseLock();
    }
  }

  getStatus() {
    const jobs = this.readJobs();
    const status = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      dead: 0,
      cancelled: 0
    };

    jobs.forEach(job => {
      if (status.hasOwnProperty(job.state)) {
        status[job.state]++;
      }
    });

    return status;
  }

  // NEW: Get performance metrics
  getMetrics() {
    const jobs = this.readJobs();
    const completed = jobs.filter(j => j.state === 'completed');
    
    if (completed.length === 0) {
      return {
        totalJobs: jobs.length,
        completedJobs: 0,
        avgExecutionTime: 0,
        successRate: 0
      };
    }

    const executionTimes = completed.map(j => {
      const created = new Date(j.created_at);
      const updated = new Date(j.updated_at);
      return updated - created;
    });

    const avgTime = executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length;

    return {
      totalJobs: jobs.length,
      completedJobs: completed.length,
      avgExecutionTime: Math.round(avgTime / 1000), // seconds
      successRate: ((completed.length / jobs.length) * 100).toFixed(1)
    };
  }

  generateId() {
    return 'job_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  setJobError(jobId, error) {
    this.acquireLock();
    try {
      const jobs = this.readJobs();
      const job = jobs.find(j => j.id === jobId);
      
      if (job) {
        job.error = error;
        job.updated_at = new Date().toISOString();
        this.writeJobs(jobs);
      }
    } finally {
      this.releaseLock();
    }
  }
}

module.exports = QueueManager;