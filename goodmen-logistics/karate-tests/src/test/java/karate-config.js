function fn() {
  // Environment configuration
  var env = karate.env; // get java system property 'karate.env'
  karate.log('karate.env system property was:', env);
  
  if (!env) {
    env = 'dev'; // default to dev if not set
  }

  // Base configuration for all environments
  var config = {
    env: env,
    baseUrl: 'https://safetyapp-ln58.onrender.com/api',
    apiTimeout: 10000,
    retryInterval: 1000,
    maxRetries: 3
  };

  // Environment-specific configurations
  if (env == 'dev') {
    config.baseUrl = 'http://localhost:3000/api';
  } else if (env == 'qa') {
    config.baseUrl = 'http://qa.goodmenlogistics.com/api';
  } else if (env == 'staging') {
    config.baseUrl = 'http://staging.goodmenlogistics.com/api';
  } else if (env == 'prod') {
    config.baseUrl = 'https://safetyapp-ln58.onrender.com/api';
  }

  // Common headers
  config.headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  // Common functions
  config.generateRandomString = function(length) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var result = '';
    for (var i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  config.generateRandomNumber = function(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };

  config.getCurrentDate = function() {
    return new Date().toISOString().split('T')[0];
  };

  config.getFutureDate = function(daysAhead) {
    var date = new Date();
    date.setDate(date.getDate() + daysAhead);
    return date.toISOString().split('T')[0];
  };

  config.waitForCondition = function(conditionFn, timeout, interval) {
    var startTime = Date.now();
    timeout = timeout || config.apiTimeout;
    interval = interval || config.retryInterval;
    
    while (Date.now() - startTime < timeout) {
      if (conditionFn()) {
        return true;
      }
      java.lang.Thread.sleep(interval);
    }
    return false;
  };

  karate.configure('connectTimeout', config.apiTimeout);
  karate.configure('readTimeout', config.apiTimeout);
  karate.configure('retry', { count: config.maxRetries, interval: config.retryInterval });

  karate.log('Environment config:', config);
  return config;
}
