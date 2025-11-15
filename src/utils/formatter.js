const chalk = require('chalk');

function formatJobOutput(job) {
  const stateColors = {
    pending: chalk.yellow,
    processing: chalk.blue,
    completed: chalk.green,
    failed: chalk.red,
    dead: chalk.gray,
    cancelled: chalk.magenta
  };

  const color = stateColors[job.state] || chalk.white;
  
  let output = `
${chalk.bold('Job ID:')} ${job.id}
${chalk.bold('Command:')} ${job.command}
${chalk.bold('State:')} ${color(job.state)}`;

  // Add priority if it exists
  if (job.priority !== undefined) {
    output += `\n${chalk.bold('Priority:')} ${job.priority}`;
  }

  output += `
${chalk.bold('Attempts:')} ${job.attempts}/${job.max_retries}
${chalk.bold('Created:')} ${job.created_at}
${chalk.bold('Updated:')} ${job.updated_at}`;

  if (job.next_retry_at) {
    output += `\n${chalk.bold('Next Retry:')} ${job.next_retry_at}`;
  }

  if (job.timeout) {
    output += `\n${chalk.bold('Timeout:')} ${job.timeout}ms`;
  }

  if (job.error) {
    output += `\n${chalk.bold('Error:')} ${chalk.red(job.error)}`;
  }

  output += '\n' + '-'.repeat(50);
  
  return output;
}

function formatStatus(status, workers) {
  let output = chalk.bold.cyan('\n=== Queue Status ===\n');
  
  output += `\n${chalk.bold('Jobs:')}\n`;
  output += `  Pending: ${chalk.yellow(status.pending)}\n`;
  output += `  Processing: ${chalk.blue(status.processing)}\n`;
  output += `  Completed: ${chalk.green(status.completed)}\n`;
  output += `  Failed: ${chalk.red(status.failed)}\n`;
  output += `  Dead (DLQ): ${chalk.gray(status.dead)}\n`;
  
  if (status.cancelled && status.cancelled > 0) {
    output += `  Cancelled: ${chalk.magenta(status.cancelled)}\n`;
  }
  
  output += `\n${chalk.bold('Workers:')}\n`;
  output += `  Total: ${workers.total}\n`;
  output += `  Busy: ${chalk.blue(workers.busy)}\n`;
  output += `  Idle: ${chalk.green(workers.idle)}\n`;
  
  if (workers.workers && workers.workers.length > 0) {
    output += `\n${chalk.bold('Worker Details:')}\n`;
    workers.workers.forEach(w => {
      const status = w.status === 'busy' ? chalk.blue(w.status) : chalk.green(w.status);
      const job = w.currentJob ? ` (Job: ${w.currentJob})` : '';
      
      // Add stats if available
      let stats = '';
      if (w.jobsProcessed !== undefined) {
        stats = chalk.dim(` [Processed: ${w.jobsProcessed}, Errors: ${w.errors || 0}]`);
      }
      
      output += `  ${w.id}: ${status}${job}${stats}\n`;
    });
  }
  
  return output;
}

function formatMetrics(metrics) {
  let output = chalk.bold.cyan('\n=== Performance Metrics ===\n');
  
  output += `\n${chalk.bold('Total Jobs:')} ${metrics.totalJobs}\n`;
  output += `${chalk.bold('Completed Jobs:')} ${chalk.green(metrics.completedJobs)}\n`;
  output += `${chalk.bold('Success Rate:')} ${chalk.green(metrics.successRate + '%')}\n`;
  output += `${chalk.bold('Avg Execution Time:')} ${metrics.avgExecutionTime}s\n`;
  
  return output;
}

module.exports = {
  formatJobOutput,
  formatStatus,
  formatMetrics
};