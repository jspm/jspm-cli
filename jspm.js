define(['http-amd/json'], function(http) {
  var baseUrl = 'https://api.jspm.io';
  
  var logStyle = {
    msg: 'color: #333;',
    ok: 'color: #6D5;'
    warn: 'color: #EB3;',
    error: 'color: #B01;'
  };
  var log = function(msg, type) {
    console.log('%c' + msg, 'font-size: 12px; font-family: monospace; padding-left: 20px;' + logStyle[type || 'msg']);
  }
  
  var jspm = {
    login: function(username, password) {
      username = username || prompt('Enter your username:');
      password = password || prompt('Enter your password:');
      console.log('Logging in...');
      http.post(baseUrl + '/login', {
        username: username,
        password: password
      }, function(res) {
        jspm.key = res.key;
        delete res.key;
        if (res.result == 'ok')
          console.log('Login successful.', 'ok');
        else if (res.result == 'error')
          console.log(res.message, 'warn');
      }, function(err) {
        console.log(err.message || err, 'error');
      });
    },
    register: function(username, password, email) {
      username = username || prompt('Enter a username:');
      password = password || prompt('Enter your password:');
      email = email || prompt('Enter your email:');
      console.log('Registering...');
      http.post(baseUrl + '/register', {
        username: username,
        password: password,
        email: email
      }, function(res) {
        jspm.key = res.key;
        delete res.key;
        if (res.result == 'ok')
          console.log('Registration complete.', 'ok');
        else if (res.result == 'error')
          console.log(res.message, 'warn');
      }, function(err) {
        console.log(err.message || err, 'error');
      });
    },
    publish: function(name, endpoint, version, options) {
      console.log('Publishing ' + name + '...');
      options = options || {};
      options.name = name;
      options.endpoint = endpoint;
      options.version = version;
      options.key = this.key;
      http.post(baseUrl + '/publish', options, function(res) {
        if (res.result == 'ok')
          console.log(name + '#' + version + ' successfully published.', 'ok');
        else if (res.result == 'error')
          console.log(res.message, 'warn');
      }, function(err) {
        console.log(err.message || err, 'error');
      });
      delete options.key;
    },
    publishAll: function(name, endpoint) {
      console.log('Publishing all versions of ' + name + '...');
      http.post(baseUrl + '/publish_all', {
        name: name,
        endpoint: endpoint,
        key: this.key
      }, function(res) {
        if (res.status == 'ok') {
          if (res.created.length)
            console.log('Successfully published versions ' + res.created.join(', ') + ' of ' + name + '.', 'ok');
          else
            console.log('No new versions of ' + name + ' to publish.', 'ok');
        }
        else if (res.result == 'error')
          console.log(res.message, 'warn');
      }, function(err) {
        console.log(err.message || err, 'error');
      });
    } 
  };
  window.jspm = jspm;
  return jspm;
});
