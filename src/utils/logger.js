const chalk = require('chalk');

class Logger {
  constructor() {
    this.levels = {
      DEBUG: 0,
      INFO: 1,
      WARN: 2,
      ERROR: 3
    };
    
    // Set via environment variable: LOG_LEVEL=DEBUG
    this.currentLevel = this.levels[process.env.LOG_LEVEL || 'INFO'];
  }

  log(level, message, meta = {}) {
    if (this.levels[level] < this.currentLevel) {
      return; // Skip if below current log level
    }

    const timestamp = new Date().toISOString();
    const levelColors = {
      DEBUG: chalk.gray,
      INFO: chalk.blue,
      WARN: chalk.yellow,
      ERROR: chalk.red
    };
    
    const color = levelColors[level] || chalk.white;
    const metaStr = Object.keys(meta).length > 0 
      ? ' ' + JSON.stringify(meta) 
      : '';
    
    console.log(
      `${chalk.gray(timestamp)} ${color(`[${level}]`)} ${message}${chalk.dim(metaStr)}`
    );
  }
  
  debug(message, meta = {}) {
    this.log('DEBUG', message, meta);
  }
  
  info(message, meta = {}) {
    this.log('INFO', message, meta);
  }
  
  warn(message, meta = {}) {
    this.log('WARN', message, meta);
  }
  
  error(message, meta = {}) {
    this.log('ERROR', message, meta);
  }
}

module.exports = new Logger();