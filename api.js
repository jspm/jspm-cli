var core = require('./lib/core');
var ui = require('./lib/ui');
var EventEmitter = require('events').EventEmitter;

var API = module.exports = new EventEmitter();

/*
 * jspm.on('log', function(type, msg) { console.log(msg); });
 * jspm.on('prompt', function(prompt, callback) {
 *   if (prompt.type == 'confirm')
 *     callback({ confirm: true });
 *   if (prompt.type == 'input')
 *     callback({ input: value });
 * });
 *
 * Prompt as defined in https://github.com/SBoudrias/Inquirer.js/tree/master#question
 * Callback answer defined in https://github.com/SBoudrias/Inquirer.js/tree/master#answers
 */
ui.setResolver(API);

/* 
 * Installs a library in the current folder
 * returns a promise
 * 
 * jspm.install('jquery')
 * jspm.install('jquery', 'github:components/jquery@^2.0.0')
 * jspm.install('jquery', '2')
 * jspm.install('jquery', 'github:components/jquery')
 * jspm.install('jquery', { force: true });
 * jspm.install({ jquery: '1.2.3' }, { force: true })
 * jspm.install('jquery', { primary: false }); // not saved to packge.json
 *
 */
API.install = function(name, target, options) {
  return core.install.apply(core, arguments);
}


/*
 * Returns a promise for the full install tree of some form?
 */
// API.installed = function() {
// }