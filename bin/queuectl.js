#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const readline = require('readline');
const QueueManager = require('../src/queue-manager');
const WorkerManager = require('../src/worker-manager');
const ConfigManager = require('../src/config-manager');
const { formatJobOutput, formatStatus, formatMetrics } = require('../src/utils/formatter');

const program = new Command();
const queueManager = new QueueManager();
const workerManager = new WorkerManager(queueManager);
const configManager = new ConfigManager();

program
  .name('queuectl')
  .description('CLI-based background job queue system')
  .version('1.0.0');

// Enqueue command
program
  .command('enqueue [job]')
  .description('Add a new job to the queue')
  .option('-c, --command <command>', 'Job command to execute')
  .option('-i, --id <id>', 'Job ID (optional)')
  .option('-r, --retries <number>', 'Max retries', '3')
  .option('-p, --priority <number>', 'Priority (1=high, 5=low)', '5')
  .option('-t, --timeout <ms>', 'Timeout in milliseconds', '300000')
  .option('--interactive', 'Interactive mode')
  .action((jobJson, options) => {
    try {
      let jobData;

      if (options.command) {
        jobData = {
          command: options.command,
          max_retries: parseInt(options.retries)
        };
        
        // Add priority if supported by queue-manager
        if (options.priority) {
          jobData.priority = parseInt(options.priority);
        }
        
        // Add timeout if supported
        if (options.timeout) {
          jobData.timeout = parseInt(options.timeout);
        }
        
        if (options.id) {
          jobData.id = options.id;
        }
      }
      else if (options.interactive) {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });

        rl.question('Enter command: ', (command) => {
          rl.question('Enter max retries (default 3): ', (retries) => {
            rl.question('Enter priority 1-5 (default 5): ', (priority) => {
              rl.question('Enter job ID (optional): ', (id) => {
                jobData = {
                  command: command,
                  max_retries: retries ? parseInt(retries) : 3,
                  priority: priority ? parseInt(priority) : 5
                };
                if (id) jobData.id = id;

                const job = queueManager.enqueue(jobData);
                console.log(chalk.green('✓ Job enqueued successfully'));
                console.log(formatJobOutput(job));
                rl.close();
              });
            });
          });
        });
        return;
      }
      else if (jobJson) {
        jobJson = jobJson.replace(/^['"`]|['"`]$/g, '');
        jobData = JSON.parse(jobJson);
      }
      else {
        console.error(chalk.red('Error: No job data provided'));
        console.log(chalk.yellow('\nUsage examples:'));
        console.log(chalk.cyan('  1. Using flags (recommended):'));
        console.log(chalk.white('     queuectl enqueue -c "echo Hello World"'));
        console.log(chalk.white('     queuectl enqueue -c "sleep 5" -p 1 -r 5'));
        console.log(chalk.cyan('\n  2. Interactive mode:'));
        console.log(chalk.white('     queuectl enqueue --interactive'));
        process.exit(1);
      }

      const job = queueManager.enqueue(jobData);
      console.log(chalk.green('✓ Job enqueued successfully'));
      console.log(formatJobOutput(job));
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Add quick command
program
  .command('add <command>')
  .description('Quick add job with command')
  .option('-r, --retries <number>', 'Max retries', '3')
  .option('-p, --priority <number>', 'Priority (1=high, 5=low)', '5')
  .action((command, options) => {
    try {
      const jobData = {
        command: command,
        max_retries: parseInt(options.retries)
      };
      
      if (options.priority) {
        jobData.priority = parseInt(options.priority);
      }
      
      const job = queueManager.enqueue(jobData);
      console.log(chalk.green('✓ Job added:'), job.id);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Worker commands
const worker = program.command('worker').description('Manage worker processes');

worker
  .command('start')
  .option('-c, --count <number>', 'Number of workers', '1')
  .description('Start worker processes')
  .action((options) => {
    try {
      const count = parseInt(options.count);
      workerManager.start(count);
      console.log(chalk.green(`✓ Started ${count} worker(s)`));
      console.log(chalk.yellow('Press Ctrl+C to stop workers gracefully'));
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

worker
  .command('stop')
  .description('Stop all workers gracefully')
  .action(() => {
    try {
      workerManager.stop();
      console.log(chalk.green('✓ Workers stopped successfully'));
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Status command
program
  .command('status')
  .description('Show queue status and active workers')
  .action(() => {
    try {
      const status = queueManager.getStatus();
      const workers = workerManager.getStatus();
      console.log(formatStatus(status, workers));
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Metrics command (if available)
program
  .command('metrics')
  .description('Show performance metrics')
  .action(() => {
    try {
      // Check if getMetrics exists
      if (typeof queueManager.getMetrics === 'function') {
        const metrics = queueManager.getMetrics();
        console.log(formatMetrics(metrics));
      } else {
        console.log(chalk.yellow('Metrics feature not available yet'));
        console.log('Tip: Update queue-manager.js with getMetrics() method');
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// List command
program
  .command('list')
  .option('-s, --state <state>', 'Filter by state')
  .description('List jobs')
  .action((options) => {
    try {
      const jobs = queueManager.listJobs(options.state);
      if (jobs.length === 0) {
        console.log(chalk.yellow('No jobs found'));
        return;
      }
      jobs.forEach(job => console.log(formatJobOutput(job)));
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Cancel command (if available)
program
  .command('cancel <jobId>')
  .description('Cancel a pending job')
  .action((jobId) => {
    try {
      // Check if cancelJob exists
      if (typeof queueManager.cancelJob === 'function') {
        queueManager.cancelJob(jobId);
        console.log(chalk.green(`✓ Job ${jobId} cancelled`));
      } else {
        console.log(chalk.yellow('Cancel feature not available yet'));
        console.log('Tip: Update queue-manager.js with cancelJob() method');
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// DLQ commands
const dlq = program.command('dlq').description('Manage Dead Letter Queue');

dlq
  .command('list')
  .description('List jobs in DLQ')
  .action(() => {
    try {
      const jobs = queueManager.listDLQ();
      if (jobs.length === 0) {
        console.log(chalk.yellow('DLQ is empty'));
        return;
      }
      jobs.forEach(job => console.log(formatJobOutput(job)));
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

dlq
  .command('retry <jobId>')
  .description('Retry a job from DLQ')
  .action((jobId) => {
    try {
      queueManager.retryFromDLQ(jobId);
      console.log(chalk.green(`✓ Job ${jobId} moved back to pending`));
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Config commands
const config = program.command('config').description('Manage configuration');

config
  .command('set <key> <value>')
  .description('Set configuration value')
  .action((key, value) => {
    try {
      configManager.set(key, value);
      console.log(chalk.green(`✓ Configuration updated: ${key} = ${value}`));
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

config
  .command('get <key>')
  .description('Get configuration value')
  .action((key) => {
    try {
      const value = configManager.get(key);
      console.log(`${key}: ${value}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

config
  .command('list')
  .description('List all configuration')
  .action(() => {
    try {
      const cfg = configManager.getAll();
      console.log(chalk.bold('Configuration:'));
      Object.entries(cfg).forEach(([key, value]) => {
        console.log(`  ${key}: ${value}`);
      });
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n⚠  Shutting down gracefully...'));
  workerManager.stop();
  setTimeout(() => process.exit(0), 100);
});

process.on('SIGTERM', () => {
  workerManager.stop();
  setTimeout(() => process.exit(0), 100);
});

program.parse();