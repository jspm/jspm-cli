define(['http-amd/json'], function(http) {
  var baseUrl = 'https://api.jspm.io';
  
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
          console.log('Login successful.');
        else if (res.result == 'error')
          console.log(res.message);
      }, function(err) {
        console.log(err.message || err);
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
          console.log('Registration complete.');
        else if (res.result == 'error')
          console.log(res.message);
      }, function(err) {
        console.log(err.message || err);
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
          console.log(name + '#' + version + ' successfully published.');
        else if (res.result == 'error')
          console.log(res.message);
      }, function(err) {
        console.log(err.message || err);
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
            console.log('Successfully published versions ' + res.created.join(', ') + ' of ' + name + '.');
          else
            console.log('No new versions of ' + name + ' to publish.');
        }
        else if (res.result == 'error')
          console.log(res.message);
      }, function(err) {
        console.log(err.message || err);
      });
    } 
  };
  window.jspm = jspm;
  return jspm;
});
