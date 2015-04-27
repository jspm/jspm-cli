/*
 *   Copyright 2014-2015 Guy Bedford (http://guybedford.com)
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
 require('core-js/es6/string');

var ui = require('./lib/ui');
var chalk = require('chalk');
var config = require('./lib/config');
var globalConfig = require('./lib/global-config');
var core = require('./lib/core');
var bundle = require('./lib/bundle');
var registry = require('./lib/registry');
var install = require('./lib/install');
var fs = require('graceful-fs');
var Promise = require('rsvp').Promise;

var link = require('./lib/link');

var build = require('./lib/build');

require('rsvp').on('error', function(reason) {
  ui.log('warn', 'Unhandled promise rejection.\n' + reason && reason.stack || reason || '' + '\n');
});

process.on('uncaughtException', function(err) {
  ui.log('err', err.stack || err);
});

/* jshint laxbreak: true */

(function() {
  function showHeader() {
    ui.log('\n'
      + '  ' + chalk.bgWhite('      ') + '\n'
      + '  \033[47m\033[93m\033[1m jspm \033[0m\033[90m  ' + chalk.grey('Browser Package Management') + '\n'
      + '  ' + chalk.bgWhite('      ') + '\n'
    );
  }

  function showInstructions() {
    showHeader();
    ui.log('\n'
      + 'jspm run main                      Run a jspm module in Node\n'
      + '\n'
      + 'jspm init [basepath] [--prompts]   Create / validate project configuration file\n'
      + '\n'
      + 'jspm install <name[=target]+> [--force skips cache] [--latest]\n'
      + '  install jquery                   Install a package looked up in the jspm registry\n'
      + '  install react=npm:react          Install a package from a registry to latest\n'
      + '  install jquery=2 react           Install a package to a version or range\n'
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
      + 'jspm link registry:pkg@version     Link a local folder as an installable package\n'
      + 'jspm install --link registry:name  Install a linked package\n'
      + '\n'
      + 'jspm dl-loader [--edge --source]   Download the browser loader files\n'
      + 'jspm dl-loader [--babel|--traceur]  Choose which ES6 transpiler to use\n'
      + '\n'
      + 'jspm setmode <mode>\n'
      + '  setmode local                    Switch to locally downloaded libraries\n'
      + '  setmode remote                   Switch to CDN external package sources\n'
      + '\n'
      + 'jspm bundle moduleA + module/b [outfile] [--minify] [--no-mangle] [--inject] [--skip-source-maps]\n'
      + 'jspm bundle-sfx app/main [outfile] Export bundle as a single self-executing script\n'
      + 'jspm unbundle                      Remove injected bundle configuration\n'
      + 'jspm depcache moduleName           Stores dep cache in config for flat pipelining\n'
      + '\n'
      + 'jspm registry <command>            Manage registries\n'
      + '  registry config <name>           Configure an existing registry\n'
      + '  registry create <name> <pkg>     Create a new custom registry instance\n'
      // + '  registry export <registry-name>  Export an registry programatically\n'
      + '\n'
      + 'jspm config <option> <setting>     Configure jspm global options\n'
      + '                                   Stored in ~/.jspm/config\n'
      + '\n'
      + 'jspm cache-clear                   Clear global caches, not recommended\n'
      + '\n'
      + 'All options work with the -y flag to skip prompts\n'
    );
  }

  function showVersion() {
    ui.log(require('./package.json').version + '\n'
      + (process.env.localJspm === 'true' ? 'Running against local jspm install.' : 'Running against global jspm install.')
    );
  }

  function dwalk(obj, visitor, pname) {
    for (var p in obj) {
      if (!obj.hasOwnProperty(p))
        continue;
      if (typeof obj[p] === 'object')
        dwalk(obj[p], visitor, (pname ? pname + '.' : '') + p);
      else
        visitor((pname ? pname + '.' : '') + p, obj[p]);
    }
  }

  function readOptions(args, flags, settings) {
    settings = settings || [];
    var argOptions = { args: [] }, i, j, k;
    for (i = 0; i < args.length; i++) {
      if (args[i].startsWith('--')) {
        for (j = 0; j < flags.length; j++)
          if (flags[j] === args[i])
            argOptions[flags[j].substr(2)] = i;
        for (j = 0; j < settings.length; j++)
          if (settings[j] === args[i])
            argOptions[settings[j].substr(2)] = args[++i];
      }
      else if (args[i].startsWith('-') && args[i].length > 1) {
        var opts = args[i].substr(1);
        opl: for (j = 0; j < opts.length; j++) {
          for (k = 0; k < flags.length; k++) {
            if (flags[k].substr(2, 1) === opts[j]) {
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

  var args = process.argv.splice(2),
      options;

  switch(args[0]) {
    case 'run':
      core.run(args[1]);
      break;

    case 'inject':
      var inject = true;

    case 'update':
      var doUpdate = true;

    case 'i':
    case 'install':
      options = readOptions(args, ['--force', '--override', '--link', '--yes', '--lock', '--latest', '--unlink', '--quick', '--dev']);
      options.inject = inject;
      options.doUpdate = doUpdate;

      args = options.args;

      var depMap;
      for (var i = 1; i < (options.override || args.length); i++) {
        depMap = depMap || {};
        var name, target;
        var arg = args[i];
        name = arg.split('=')[0];
        target = arg.split('=')[1];

        if (!target) {
          target = name;
          if (name.indexOf(':') !== -1)
            name = name.substr(name.indexOf(':') + 1);
          if (name.indexOf('@') > 0)
            name = name.substr(0, name.lastIndexOf('@'));
        }

        if (target.indexOf(':') === -1)
          target = globalConfig.config.defaultRegistry + ':' + target;

        depMap[name] = target || '';
      }

      var override = options.override && args.splice(options.override).join(' ');
      if (override) {
        if (!override.startsWith('{')) {
          try {
            options.override = fs.readFileSync(override);
          }
          catch(e) {
            return ui.log('err', 'Unable to read override file %' + override + '%.');
          }
          try {
            options.override = JSON.parse(options.override);
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
        return core.checkDlLoader();
      })
      .then(function() {
        return core.setMode(inject ? 'remote' : 'local');
      })
      .then(function() {
        ui.log('');
        ui.log('ok', 'Install complete.');
        process.exit();
      }, function(err) {
        // something happened (cancel / err)
        if (err)
          ui.log('err', err.stack || err);
        ui.log('warn', 'Installation changes not saved.');
        process.exit(1);
      });

      break;

    case 'r':
    case 'remove':
    case 'uninstall':
      options = readOptions(args, ['--yes']);

      if (options.yes)
        ui.useDefaults();

      install.uninstall(options.args.splice(1))
      .then(function() {
        ui.log('');
        ui.log('ok', 'Uninstall complete.');
      }, function(err) {
        ui.log('err', err.stack || err);
        ui.log('warn', 'Uninstall changes not saved.');
        process.exit(1);
      });
      break;

    case 'resolve':
      options = readOptions(args, ['--only']);

      if (!options.only)
        return ui.log('warn', 'Use %jspm resolve --only registry:pkg@version%');

      install.resolveOnly(options.args[1])
      .catch(function(err) {
        if (!err)
          ui.log('err', 'Resolve operation not performed.');
        else
          ui.log('err', err.stack || err);
        process.exit(1);
      });
      break;

    case 'clean':
      options = readOptions(args, ['--yes']);
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
      options = readOptions(args, ['--forks']);
      args = options.args;

      config.load()
      .then(function() {
        if (!args[1])
          return install.showVersions(options.forks);
        if (!args[1].includes(':'))
          return ui.log('warn', 'Enter a full package name of the format `registry:repo`.');
        return install.showInstallGraph(args[1]);
      })
      .catch(function(e) {
        ui.log('err', e.stack || e);
      });
      break;

    case 'init':
      options = readOptions(args, ['--yes', '--prompts']);
      if (options.yes)
        ui.useDefaults();
      core.init(options.args[1], options.prompts);
      break;

    case 'dl-loader':
      options = readOptions(args, ['--source', '--edge', '--yes', '--babel', '--traceur']);
      if (options.yes)
        ui.useDefaults();
      core.dlLoader(options.babel && 'babel' || options.traceur && 'traceur', options.source, options.edge, true);
      break;

    case 'setmode':
      options = readOptions(args, ['--yes']);
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
      options = readOptions(args, ['--yes']);
      if (options.yes)
        ui.useDefaults();
      bundle.depCache(args[1]);
      break;

    case 'b':
    case 'bundle-sfx':
      var sfxBundle = true;

    case 'bundle':
      options = readOptions(args, ['--inject', '--yes', '--skip-source-maps', '--minify',  '--no-mangle', '--hires-source-maps', '--no-runtime']);
      if (options.yes)
        ui.useDefaults();
      options.sourceMaps = !options['skip-source-maps'];
      options.lowResSourceMaps = !options['hires-source-maps'];
      options.mangle = !options['no-mangle'];
      var bArgs = options.args.splice(1);

      if (bArgs.length === 0) {
        return ui.log('warn', 'You must provide at least one module as the starting point for bundling');
      }

      if (bArgs.length < 2) {
        (sfxBundle ? bundle.bundleSFX : bundle.bundle)(bArgs[0], undefined, options)
        .catch(function() {
          process.exit(1);
        });
      }
      else {
        var secondLastArg = bArgs[bArgs.length - 2].trim();
        var signChar = secondLastArg.substr(secondLastArg.length - 1, 1);
        var expression = '';
        var fileName;

        // we can write: jspm bundle app + other
        if (['+', '-'].indexOf(signChar) !== -1) {
          expression = bArgs.join(' ');
        }
        // or we can write: jspm bundle app + other out.js
        else {
          expression = bArgs.splice(0, bArgs.length - 1).join(' ');
          fileName = bArgs[bArgs.length - 1];
        }
        (sfxBundle ? bundle.bundleSFX : bundle.bundle)(expression, fileName, options)
        .catch(function() {
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

    case 'build':
      options = readOptions(args, ['--yes']);
      if (options.yes)
        ui.useDefaults();
      core.build();
      break;

    case 'compile':
      options = readOptions(args, ['--transpile', '--minify', '--removeJSExtensions', '--yes'], ['--map', '--format']);
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
      break;

    case 'link':
      options = readOptions(args, ['--force', '--yes']);

      if (options.yes)
        ui.useDefaults();

      args = options.args;

      var linkname = args[2] || args[1] || '';
      var linkpath = args[2] || '.';

      link.link(linkname, linkpath, options.force);
      break;

    case 'registry':
      options = readOptions(args, ['--yes']);

      if (options.yes)
        ui.useDefaults();

      var action = args[1];

      if (action === 'config') {
        if (!args[2])
          return ui.log('warn', 'You must provide an registry name to configure.');
        return Promise.resolve(registry.configure(args[2]))
        .then(function() {
          ui.log('ok', 'Registry %' + args[2] + '% configured successfully.');
        }, function(err) {
          ui.log('err', err.stack || err);
        });
      }
      else if (action === 'create') {
        if (!args[2])
          return ui.log('warn', 'You must provide an registry name to create.');
        if (!args[3])
          return ui.log('warn', 'You must provide the registry module name to generate from.');
        return Promise.resolve(registry.create(args[2], args[3]))
        .then(function(created) {
          if (created)
            ui.log('ok', 'Enpoint %' + args[2] + '% created successfully.');
        }, function(err) {
          ui.log('err', err.stack || err);
        });
      }
      else if (action === 'export') {
        if (!args[2])
          return ui.log('warn', 'You must provide an registry name to export.');
        if (!globalConfig.config.registries[args[2]])
          return ui.log('warn', 'Registry %' + args[2] + '% does not exist.');

        var registryConfig = globalConfig.config.registries[args[2]];

        dwalk(registryConfig, function(p, value) {
          process.stdout.write('jspm config registries.' + args[2] + '.' + p + ' ' + value + '\n');
        });
      }
      else {
        showInstructions();
        ui.log('warn', 'Invalid registry argument %' + args[1] + '%.');
      }
      break;

    case 'c':
    case 'config':
      var property = args[1];
      var value = args.splice(2).join(' ');
      globalConfig.set(property, value);
      break;

    case 'cc':
    case 'cache-clear':
      core.cacheClear();
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
