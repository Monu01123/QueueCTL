const path = require('path');
const fs = require('fs');

class ConfigManager {
  constructor(dataPath = './data') {
    this.dataPath = dataPath;
    this.configFile = path.join(dataPath, 'config.json');
    
    if (!fs.existsSync(dataPath)) {
      fs.mkdirSync(dataPath, { recursive: true });
    }
    
    this.initConfig();
  }

  initConfig() {
    if (!fs.existsSync(this.configFile)) {
      const defaults = {
        'max-retries': 3,
        'backoff-base': 2
      };
      fs.writeFileSync(this.configFile, JSON.stringify(defaults, null, 2));
    }
  }

  readConfig() {
    try {
      const data = fs.readFileSync(this.configFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return {
        'max-retries': 3,
        'backoff-base': 2
      };
    }
  }

  writeConfig(config) {
    fs.writeFileSync(this.configFile, JSON.stringify(config, null, 2));
  }

  set(key, value) {
    const validKeys = ['max-retries', 'backoff-base'];
    
    if (!validKeys.includes(key)) {
      throw new Error(`Invalid config key. Valid keys: ${validKeys.join(', ')}`);
    }

    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue <= 0) {
      throw new Error('Value must be a positive number');
    }

    const config = this.readConfig();
    config[key] = numValue;
    this.writeConfig(config);
  }

  get(key) {
    const config = this.readConfig();
    return config[key] || null;
  }

  getAll() {
    return this.readConfig();
  }
}

module.exports = ConfigManager;