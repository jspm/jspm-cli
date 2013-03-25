define(['http-amd/json'], function(http) {
  var baseUrl = 'http://api.jspm.co';
  
  var jscom = {
    login: function(username, password) {
      username = username || prompt('Enter your username:');
      password = password || prompt('Enter your password:');
      console.log('Logging in...');
      http.post(baseUrl + '/login', {
        username: username,
        password: password
      }, function(res) {
        jscom.key = res.key;
        delete res.key;
        if (res.result == 'ok')
          console.log('Login successful.');
      }, function(err) {
        console.log(err.response ? err.response.message : err);
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
        jscom.key = res.key;
        delete res.key;
        if (res.result == 'ok')
          console.log('Registration complete.');
      }, function(err) {
        console.log(err.response ? err.response.message : err);
      });
    },
    publish: function(name, endpoint, version) {
      console.log('Publishing ' + name + '...');
      http.post(baseUrl + '/publish', {
        name: name,
        endpoint: endpoint,
        version: version,
        key: this.key
      }, function(res) {
        if (res.result == 'ok')
          console.log(name + '#' + version + ' successfully published.');
      }, function(err) {
        console.log(err.response ? err.response.message : err);
      });
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
      }, function(err) {
        console.log(err.response ? err.response.message : err);
      });
    } 
  };
  window.jscom = jscom;
  return jscom;
});
