const { spawn } = require('child_process');
const ConfigManager = require('./config-manager');

// Try to load logger, fallback to console if not available
let logger;
try {
  logger = require('./utils/logger');
} catch (e) {
  logger = {
    info: (msg, meta) => console.log(`[INFO] ${msg}`, meta || ''),
    warn: (msg, meta) => console.log(`[WARN] ${msg}`, meta || ''),
    error: (msg, meta) => console.log(`[ERROR] ${msg}`, meta || '')
  };
}

class WorkerManager {
  constructor(queueManager) {
    this.queueManager = queueManager;
    this.configManager = new ConfigManager();
    this.workers = [];
    this.isRunning = false;
    this.activeProcesses = new Map();
  }

  start(count = 1) {
    this.isRunning = true;
    logger.info('Starting workers', { count });
    
    for (let i = 0; i < count; i++) {
      const workerId = `worker_${i + 1}`;
      this.startWorker(workerId);
    }
  }

  startWorker(workerId) {
    const worker = {
      id: workerId,
      status: 'idle',
      currentJob: null,
      jobsProcessed: 0,
      errors: 0
    };

    this.workers.push(worker);
    this.processJobs(worker);
  }

  async processJobs(worker) {
    while (this.isRunning) {
      try {
        const job = this.queueManager.getNextJob(worker.id);

        if (!job) {
          await this.sleep(1000);
          continue;
        }

        worker.status = 'busy';
        worker.currentJob = job.id;

        try {
          logger.info('Executing job', { 
            workerId: worker.id, 
            jobId: job.id,
            command: job.command 
          });

          // Check if job has timeout (new feature)
          const timeout = job.timeout || 300000; // 5 min default
          await this.executeJobWithTimeout(job, timeout);
          
          this.queueManager.updateJobState(job.id, 'completed');
          worker.jobsProcessed++;
          
          logger.info('Job completed', { 
            workerId: worker.id, 
            jobId: job.id 
          });

        } catch (error) {
          logger.error('Job failed', { 
            workerId: worker.id, 
            jobId: job.id, 
            error: error.message 
          });

          this.queueManager.setJobError(job.id, error.message);
          
          const backoffBase = this.configManager.get('backoff-base');
          this.queueManager.incrementAttempts(job.id, backoffBase);
          worker.errors++;
        }

        worker.status = 'idle';
        worker.currentJob = null;

      } catch (error) {
        logger.error('Worker error', { 
          workerId: worker.id, 
          error: error.message 
        });
        await this.sleep(1000);
      }
    }
  }

  // Execute job with timeout support
  async executeJobWithTimeout(job, timeout) {
    return new Promise((resolve, reject) => {
      let timeoutHandle;
      let childProcess;
      let completed = false;

      // Set timeout
      timeoutHandle = setTimeout(() => {
        if (completed) return;
        completed = true;
        
        logger.warn('Job timeout', { jobId: job.id, timeout });
        
        if (childProcess && !childProcess.killed) {
          childProcess.kill('SIGTERM');
          // Force kill after 5 seconds
          setTimeout(() => {
            if (childProcess && !childProcess.killed) {
              childProcess.kill('SIGKILL');
            }
          }, 5000);
        }
        
        reject(new Error(`Job timeout exceeded (${timeout}ms)`));
      }, timeout);

      // Execute the job
      this.executeJob(job)
        .then(result => {
          if (completed) return;
          completed = true;
          clearTimeout(timeoutHandle);
          resolve(result);
        })
        .catch(error => {
          if (completed) return;
          completed = true;
          clearTimeout(timeoutHandle);
          reject(error);
        });
    });
  }

  executeJob(job) {
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === 'win32';
      
      let command, args, options;

      if (isWindows) {
        command = 'cmd.exe';
        args = ['/c', job.command];
        options = {
          stdio: 'pipe',
          windowsHide: true
        };
      } else {
        command = 'sh';
        args = ['-c', job.command];
        options = {
          stdio: 'pipe'
        };
      }

      const child = spawn(command, args, options);
      
      // Track active process
      if (job.id) {
        this.activeProcesses.set(job.id, child);
      }

      let stdout = '';
      let stderr = '';

      if (child.stdout) {
        child.stdout.on('data', (data) => {
          stdout += data.toString();
        });
      }

      if (child.stderr) {
        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      }

      child.on('close', (code) => {
        if (job.id) {
          this.activeProcesses.delete(job.id);
        }
        
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Command failed with exit code ${code}: ${stderr || stdout}`));
        }
      });

      child.on('error', (error) => {
        if (job.id) {
          this.activeProcesses.delete(job.id);
        }
        reject(new Error(`Failed to execute command: ${error.message}`));
      });
    });
  }

  // Cancel a running job (if supported)
  cancelJob(jobId) {
    const child = this.activeProcesses.get(jobId);
    if (child && !child.killed) {
      logger.info('Cancelling running job', { jobId });
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5000);
      this.activeProcesses.delete(jobId);
      return true;
    }
    return false;
  }

  stop() {
    this.isRunning = false;
    logger.info('Stopping workers gracefully...');
    
    const maxWait = 30000; // 30 seconds
    const startTime = Date.now();

    const waitInterval = setInterval(() => {
      const busyWorkers = this.workers.filter(w => w.status === 'busy');
      
      if (busyWorkers.length === 0 || (Date.now() - startTime) > maxWait) {
        clearInterval(waitInterval);
        
        if (busyWorkers.length > 0) {
          logger.warn('Force stopping workers', { 
            busyCount: busyWorkers.length 
          });
        }
        
        this.workers = [];
        logger.info('All workers stopped');
      }
    }, 100);
  }

  getStatus() {
    const status = {
      total: this.workers.length,
      busy: this.workers.filter(w => w.status === 'busy').length,
      idle: this.workers.filter(w => w.status === 'idle').length,
      workers: this.workers.map(w => ({
        id: w.id,
        status: w.status,
        currentJob: w.currentJob,
        jobsProcessed: w.jobsProcessed,
        errors: w.errors
      }))
    };

    return status;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = WorkerManager;