"format register";

System.register("ember", [], false, function(__require, __exports, __moduleName) {
  System.get("@@global-helpers").prepareGlobal(__moduleName, []);
  //ember ...
    
  return System.get("@@global-helpers").retrieveGlobal(__moduleName, false);
});

System.register("react", [], false, function(__require, __exports, __moduleName) {
  System.get("@@global-helpers").prepareGlobal(__moduleName, []);
  //yo
    
  return System.get("@@global-helpers").retrieveGlobal(__moduleName, false);
});

System.register("fixtures/js/final", ["react","jquery"], true, function(require, exports, __moduleName) {
  var global = System.global;
  var __define = global.define;
  global.define = undefined;
  var module = { exports: exports };
  var process = System.get("@@nodeProcess")["default"];
    var __filename = "fixtures/js/final.js";
    var __dirname = "fixtures/js";
  var React = require('react');
  var jQuery = require('jquery');
  
  var Final = React.createClass({
      render: function() {
          return (
              React.DOM.div(null, 
                  React.DOM.h1(null, "Final!")
              )
          );
      }
  });
  
  module.exports = Final;
  
  global.define = __define;
  return module.exports;
});
