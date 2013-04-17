define(['http-amd/json'], function(http) {
  var baseUrl = 'https://api.jspm.io';
  
  var logStyle = {
    msg: 'color: #333;',
    ok: 'color: #6D5;',
    warn: 'color: #EB3;',
    error: 'color: #B01;'
  };
  var log = function(msg, type) {
    console.log('%c' + msg, 'font-size: 12px; font-family: monospace; padding-left: 20px;' + logStyle[type || 'msg']);
  }
  
  var jspm = {
    createApp: function(name) {
      name = name || prompt('Provide an application name:');
      log('Creating application...');

      // gather up modules
      var modules = {};
      for (var m in requirejs.s.contexts._.defined) {
        var versionMatch = m.match(/([^!]*)-(\d+\.\d+\.\d+(-[a-z][0-9a-z-]*)?)\//);
        if (!versionMatch)
          continue;
        var moduleName = versionMatch[1];
        var version = versionMatch[2];
        if (modules[moduleName] && modules[moduleName].indexOf(version) == -1)
          modules[moduleName].push(version);
        else
          modules[moduleName] = [version];
      }

      http.post(baseUrl + '/createApp', {
        key: this.key,
        name: name,
        modules: modules
      }, function(res) {
        if (res.result == 'ok')
          log('Application "' + name + '" created successfully.', 'ok');
        else if (res.result == 'error')
          log(res.message, 'warn');
      }, function(err) {
        log(err.message || err, 'error');
      });
    },
    login: function(username, password) {
      username = username || prompt('Enter your username:');
      password = password || prompt('Enter your password:');
      log('Logging in...');
      http.post(baseUrl + '/login', {
        username: username,
        password: password
      }, function(res) {
        if (!res) log('No response.', 'error');
        jspm.key = res.key;
        delete res.key;
        if (res.result == 'ok')
          log('Login successful.', 'ok');
        else if (res.result == 'error')
          log(res.message, 'warn');
      }, function(err) {
        log(err.message || err, 'error');
      });
    },
    register: function(username, password, email, code) {
      code = code || prompt('Enter your beta registration code:');
      username = username || prompt('Enter a username:');
      password = password || prompt('Enter your password:');
      email = email || prompt('Enter your email:');
      log('Registering...');
      http.post(baseUrl + '/register', {
        code: code,
        username: username,
        password: password,
        email: email
      }, function(res) {
        jspm.key = res.key;
        delete res.key;
        if (res.result == 'ok')
          log('Registration complete.', 'ok');
        else if (res.result == 'error')
          log(res.message, 'warn');
      }, function(err) {
        log(err.message || err, 'error');
      });
    },
    publish: function(name, endpoint, version, options) {
      if (typeof version == 'object') {
        options = version;
        version = '';
      }
      log('Publishing ' + name + '...');
      options = options || {};
      options.name = name;
      options.endpoint = endpoint;
      options.version = version;
      options.key = this.key;
      http.post(baseUrl + '/publish', options, function(res) {
        if (res.result == 'ok')
          log(name + '#' + version + ' successfully published.', 'ok');
        else if (res.result == 'error')
          log(res.message, 'warn');
      }, function(err) {
        log(err.message || err, 'error');
      });
      delete options.key;
    },
    publishAll: function(name, endpoint) {
      log('Publishing all versions of ' + name + '...');
      http.post(baseUrl + '/publish_all', {
        name: name,
        endpoint: endpoint,
        key: this.key
      }, function(res) {
        if (res.status == 'ok') {
          if (res.created.length)
            log('Successfully published versions ' + res.created.join(', ') + ' of ' + name + '.', 'ok');
          else
            log('No new versions of ' + name + ' to publish.', 'ok');
        }
        else if (res.result == 'error')
          log(res.message, 'warn');
      }, function(err) {
        log(err.message || err, 'error');
      });
    } 
  };
  window.jspm = jspm;
  return jspm;
});
