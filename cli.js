/*
 *   Copyright 2014 Guy Bedford (http://guybedford.com)
 *
 *   Licensed under the Apache License, Version 2.0 (the "License");
 *   you may not use this file except in compliance with the License.
 *   You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *   Unless required by applicable law or agreed to in writing, software
 *   distributed under the License is distributed on an "AS IS" BASIS,
 *   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *   See the License for the specific language governing permissions and
 *   limitations under the License.
 */
var ui = require('./lib/ui');
var config = require('./lib/config');
var globalConfig = require('./lib/global-config');
var pkg = require('./lib/package');
var core = require('./lib/core');
var bundle = require('./lib/bundle');
var semver = require('./lib/semver');
var endpoint = require('./lib/endpoint');
var install = require('./lib/install');
var fs = require('graceful-fs');

var link = require('./lib/link');

var build = require('./lib/build');

process.on('uncaughtException', function(err) {
  ui.log('err', err.stack || err);
});

(function() {
  function showHeader() {
    ui.log('\n'
      + '  \033[47m\033[1m      \033[0m\n'
      + '  \033[47m\033[93m\033[1m jspm \033[0m\033[90m  '
      + 'Browser Package Management'
      + ' \033[0m\n'
      + '  \033[47m\033[1m      \033[0m\n'
    );
  }

  function showInstructions() {
    showHeader();
    ui.log('\n'
      + 'jspm run main                      Run a jspm module in Node\n'
      + '\n'
      + 'jspm init                          Create / validate project configuration file\n'
      + '\n'
      + 'jspm install <name[=target]>+ [--force skips cache] [--latest]\n'
      + '  install jquery                   Install a package from the registry to latest\n'
      + '  install react=npm:react          Install a package from an endpoint to latest\n'
      + '  install jquery=2                 Install a package to a version or range\n'
      + '\n'
      + '  install                          Reproducible / shrinkwrap install package.json\n'
      + '\n'
      + '  install react --lock             Stable install, locking existing dependencies\n'
      + '\n'
      + '  install dep -o override.json     Install with the given custom override\n'
      + '  install dep -o "{override json}"   useful for testing package overrides\n'
      + '\n'
      + 'jspm update                        Update all packages from package.json\n'
      + 'jspm uninstall name                Uninstall a package and clean dependencies\n'
      + 'jspm clean                         Clear unused and orphaned dependencies\n'
      + '\n'
      + 'jspm inspect [--forks]             View all installed package versions\n'
      + 'jspm inspect npm:source-map        View the versions and ranges of a package\n'
      + '\n'
      + 'jspm inject <name[=target]> [--force] [--latest] [--lock] [-o]\n'
      + '  inject jquery                    Identical to install, but injects config\n'
      + '                                   only instead of downloading the package\n'
      + '\n'
      + 'jspm link endpoint:name@version    Link a local folder as an installable package\n'
      + 'jspm install --link endpoint:name  Install a linked package\n'
      + '\n'
      + 'jspm dl-loader [--edge --source]   Download the jspm browser loader\n'
      + '\n'
      + 'jspm setmode <mode>\n'
      + '  setmode local                    Switch to locally downloaded libraries\n'
      + '  setmode remote                   Switch to CDN external package sources\n'
      + '  setmode dev                      Switch to the app development folder\n'
      + '  setmode production               Switch to the app production folder\n'
      + '\n'
      + 'jspm bundle moduleA + module/b [outfile] [--inject] [--skip-source-maps]\n'
      + 'jspm unbundle                      Remove injected bundle configuration\n'
      + 'jspm depcache moduleName           Stores dep cache in config for flat pipelining\n'
      + '\n'
      + 'jspm endpoint <command>            Manage endpoints\n'
      + '  endpoint config <name>           Configure an existing endpoint\n'
      + '  endpoint create <name> <pkg>     Create a new custom endpoint instance\n'
      // + '  endpoint export <endpoint-name>  Export an endpoint programatically\n'
      + '\n'
      + 'jspm config <option> <setting>     Configure jspm global options\n'
      + '                                   Stored in ~/.jspm/config\n'
      + '\n'
      + 'All options work with the -y flag to skip prompts\n'
    );
  }

  function showVersion() {
    ui.log(require('./package.json').version + '\n'
      + (process.env.localJspm == 'true' ? 'Running against local jspm install.' : 'Running against global jspm install.')
    );
  }

  var args = process.argv.splice(2);
  switch(args[0]) {
    case 'run':
      core.run(args[1]);
    break;

    case 'inject':
      var inject = true;

    case 'update':
      var doUpdate = true;

    case 'install':
      var options = readOptions(args, ['--force', '--override', '--link', '--yes', '--lock', '--latest', '--unlink']);
      options.inject = inject;

      args = options.args;

      var depMap;
      for (var i = 1; i < (options.override || args.length); i++) {
        depMap = depMap || {};
        var name, target;
        var arg = args[i];
        name = arg.split('=')[0];
        target = arg.split('=')[1];
        depMap[name] = target;
      }

      var override = options.override && args.splice(options.override).join(' ');
      if (override) {
        if (override.substr(0, 1) != '{') {
          try {
            options.override = fs.readFileSync(override);
          }
          catch(e) {
            return ui.log('err', 'Unable to read override file %' + override + '%.');
          }
          try {
            options.override = JSON.parse(options.override)
          }
          catch(e) {
            return ui.log('err', 'Invalid JSON in override file %' + override + '%.');
          }
        }
        else {
          options.override = eval('(' + override + ')');
        }
      }

      if (options.yes)
        ui.useDefaults();

      // jspm install with no arguments is locked
      if (!depMap && !doUpdate)
        options.lock = true;

      // no install package -> install from package.json dependencies
      (depMap ? install.install(depMap, options) : install.install(true, options))
      .then(function() {
        return core.checkDlLoader()
      })
      .then(function() {
        return core.setMode(inject ? 'remote' : 'local')
      })
      .then(function() {
        ui.log('');
        ui.log('ok', 'Install complete.');
        process.exit();
      }, function(err) {
        // something happened (cancel / err)
        ui.log('err', err.stack || err);
        ui.log('warn', 'Installation changes not saved.');
        process.exit(1);
      });

    break;

    case 'uninstall':
      var options = readOptions(args, ['--yes']);

      if (options.yes)
        ui.useDefaults();

      install.uninstall(args.splice(1))
      .then(function() {
        ui.log('');
        ui.log('ok', 'Uninstall complete.');
      }, function(err) {
        ui.log('err', err.stack || err);
        ui.log('warn', 'Uninstall changes not saved.');
        process.exit(1);
      });
    break;

    case 'clean':
      var options = readOptions(args, ['--yes']);
      args = options.args;

      if (options.yes)
        ui.useDefaults();

      install.clean()
      .then(function() {
        ui.log('');
        ui.log('ok', 'Project cleaned successfully.');
      }, function(err) {
        ui.log('err', err.stack || err);
        process.exit(1);
      });

    break;

    case 'inspect':
      var options = readOptions(args, ['--forks']);
      args = options.args;

      config.load()
      .then(function() {
        if (!args[1])
          return install.showVersions(options.forks);
        if (args[1].indexOf(':') == -1)
          return ui.log('warn', 'Enter a full package name of the format `endpoint:repo`.');
        return install.showInstallGraph(args[1]);
      })
      .catch(function(e) {
        ui.log('err', e.stack || e);
      });
    break;

    case 'init':
      var options = readOptions(args, ['--yes']);

      if (options.yes)
        ui.useDefaults();

      core.init();
    break;


    case 'dl-loader':
      var options = readOptions(args, ['--source', '--edge', '--yes']);
      if (options.yes)
        ui.useDefaults();
      core.dlLoader(options.source, options.edge);
    break;

    case 'setmode':
      var options = readOptions(args, ['--yes']);
      if (options.yes)
        ui.useDefaults();
      core.setMode(args.splice(1))
      .then(function(msg) {
        ui.log('ok', msg);
      }, function(err) {
        ui.log('err', err.stack || err);
      });
    break;

    case 'depcache':
      var options = readOptions(args, ['--yes']);
      if (options.yes)
        ui.useDefaults();
      bundle.depCache(args[1]);
    break;

    case 'bundle':
      var options = readOptions(args, ['--inject', '--yes', '--skip-source-maps', '--minify']);
      if (options.yes)
        ui.useDefaults();
      options.sourceMaps = !options['skip-source-maps'];
      var bArgs = options.args.splice(1);

      if (bArgs.length < 2) {
        bundle.bundle(bArgs[0], undefined, options)
        .catch(function(e) {
          process.exit(1);
        });
      }
      else {
        var secondLastArg = bArgs[bArgs.length - 2].trim();
        var signChar = secondLastArg.substr(secondLastArg.length - 1, 1);
        var expression = "";
        var fileName = undefined;

        // we can write: jspm bundle app + other
        if (["+", "-"].indexOf(signChar) != -1) {
          expression = bArgs.join(' ');
        }
        // or we can write: jspm bundle app + other out.js
        else {
          expression = bArgs.splice(0, bArgs.length - 1).join(' ');
          fileName = bArgs[bArgs.length - 1];
        }
        bundle.bundle(expression, fileName, options)
        .catch(function(e) {
          process.exit(1);
        });
      }
    break;

    case 'unbundle':
      bundle.unbundle()
      .catch(function(e) {
        ui.log('err', e.stack || e);
        process.exit(1);
      });
    break;

    case 'bundle-sfx':
      var options = readOptions(args, ['--yes', '--skip-source-maps', '--minify']);
      options.sourceMaps = !options['skip-source-maps'];
      if (options.yes)
        ui.useDefaults();
      var bArgs = options.args.splice(1);
      bundle.bundleSFX(bArgs[0], bArgs[1], options)
      .catch(function(e) {
        process.exit(1);
      });
    break;

    case 'build':
      var options = readOptions(args, ['--yes']);
      if (options.yes)
        ui.useDefaults();
      core.build()
    break;

    case 'compile':
      var options = readOptions(args, ['--transpile', '--minify', '--removeJSExtensions', '--yes'], ['--map', '--format']);
      if (options.yes)
        ui.useDefaults();
      if (options.map) {
        var mapParts = options.map.split('=');
        options.map = {};
        options.map[mapParts[0]] = mapParts[1];
      }

      build.compileDir(args[1], options)
      .then(function() {
        ui.log('ok', 'Compilation complete');
      }, function(e) {
        ui.log('err', e.stack || e);
      });

    case 'link':
      var options = readOptions(args, ['--force', '--yes']);

      if (options.yes)
        ui.useDefaults();

      args = options.args;

      var name = args[2] || args[1] || '';
      var path = args[2] || '.';

      link.link(name, path, options.force);
    break;

    case 'endpoint':
      var options = readOptions(args, ['--yes']);

      if (options.yes)
        ui.useDefaults();

      var action = args[1];

      if (action == 'config') {
        if (!args[2])
          return ui.log('warn', 'You must provide an endpoint name to configure.');
        return Promise.resolve(endpoint.configure(args[2]))
        .then(function() {
          ui.log('ok', 'Endpoint %' + args[2] + '% configured successfully.');
        }, function(err) {
          ui.log('err', err.stack || err);
        });
      }
      else if (action == 'create') {
        if (!args[2])
          return ui.log('warn', 'You must provide an endpoint name to create.');
        if (!args[3])
          return ui.log('warn', 'You must provide the endpoint module name to generate from.');
        return Promise.resolve(endpoint.create(args[2], args[3]))
        .then(function(created) {
          if (created)
            ui.log('ok', 'Enpoint %' + args[2] + '% created successfully.');
        }, function(err) {
          ui.log('err', err.stack || err);
        });
      }
      else if (action == 'export') {
        if (!args[2])
          return ui.log('warn', 'You must provide an endpoint name to export.');
        if (!globalConfig.config.endpoints[args[2]])
          return ui.log('warn', 'Endpoint %' + args[2] + '% does not exist.');

        var endpointConfig = globalConfig.config.endpoints[args[2]];

        function dwalk(obj, visitor, pname) {
          for (var p in obj) {
            if (!obj.hasOwnProperty(p))
              continue;
            if (typeof obj[p] == 'object')
              dwalk(obj[p], visitor, (pname ? pname + '.' : '') + p);
            else
              visitor((pname ? pname + '.' : '') + p, obj[p]);
          }
        }

        dwalk(endpointConfig, function(p, value) {
          process.stdout.write('jspm config endpoints.' + args[2] + '.' + p + ' ' + value + '\n');
        });
      }
      else {
        showInstructions();
        ui.log('warn', 'Invalid endpoint argument %' + args[1] + '%.');
      }
    break;

    break;
    case 'config':
      var property = args[1];
      var value = args.splice(2).join(' ');
      globalConfig.set(property, value);

    break;
    case '--help':
    case '-h':
      showInstructions();

    break;
    case '--version':
    case '-v':
      showVersion();

    break;
    default:
      showInstructions();
      if (args[0])
        ui.log('warn', 'Invalid argument %' + args[0] + '%.');
  }
})();

function readOptions(args, flags, settings) {
  settings = settings || [];
  var argOptions = { args: [] };
  for (var i = 0; i < args.length; i++) {
    if (args[i].substr(0, 2) == '--') {
      for (var j = 0; j < flags.length; j++)
        if (flags[j] == args[i])
          argOptions[flags[j].substr(2)] = i;
      for (var j = 0; j < settings.length; j++)
        if (settings[j] == args[i])
          argOptions[settings[j].substr(2)] = args[++i];
    }
    else if (args[i].substr(0, 1) == '-' && args[i].length > 1) {
      var opts = args[i].substr(1);
      opl: for (var j = 0; j < opts.length; j++) {
        for (var k = 0; k < flags.length; k++) {
          if (flags[k].substr(2, 1) == opts[j]) {
            argOptions[flags[k].substr(2)] = argOptions.args.length;
            continue opl;
          }
        }
      }
    }
    else
      argOptions.args.push(args[i]);
  }
  return argOptions;
}

