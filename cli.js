/*
 *   Copyright 2014-2016 Guy Bedford (http://guybedford.com)
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
var globalConfig = require('./lib/config/global-config');
var core = require('./lib/core');
var bundle = require('./lib/bundle');
var registry = require('./lib/registry');
var install = require('./lib/install');
var fs = require('graceful-fs');
var Promise = require('bluebird');

// load the API but revert the API resolver and defaults
require('./api');
ui.setResolver();
ui.useDefaults(false);

var readOptions = require('./lib/cli-utils').readOptions;
var readValue = require('./lib/cli-utils').readValue;
var readPropertySetters = require('./lib/cli-utils').readPropertySetters;

var link = require('./lib/link');

process.on('uncaughtException', function(err) {
  ui.log('err', err.stack || err);
  process.exit(1);
});

/* jshint laxbreak: true */

(function() {
  function showHeader() {
    ui.log('\n'
      + '  ' + chalk.bgWhite('      ') + '\n'
      + '  ' + chalk.bgWhite.yellow(' jspm ') + '  ' + chalk.grey('Browser Package Management') + '\n'
      + '  ' + chalk.bgWhite('      ') + '\n'
    );
  }

  function showInstructions() {
    showHeader();
    ui.log('\n'
      + 'jspm run main                    Run a jspm module in Node\n'
      + '\n'
      + 'jspm init [basepath]             Run project configuration prompts\n'
      + '\n'
      + 'jspm install <name[=target]+> [--force skips cache] [--dev] [--peer]\n'
      + '  install jquery                 Install a package resolved in the jspm registry\n'
      + '  install react=npm:react        Install a package from a registry to latest\n'
      + '  install jquery@2 react         Install a package to a version or range\n'
      + '\n'
      + '  install                        Reproducible / shrinkwrap install package.json\n'
      + '\n'
      + '  install react --lock           Stable install, locking existing dependencies\n'
      + '  install react=npm:react --edge Install a package alias to latest unstable\n'
      + '  install react --quick          Quick install, skipping tree hash verifications\n'
      + '  install react --exact          Install and pin the latest version of a package\n'
      + '\n'
      + '  install dep -o override.json   Install with the given custom override\n'
      + '  install dep -o "{json}"        useful for testing package overrides\n'
      + '\n'
      + 'jspm install                     Install all pjson packages with jspm.js version lock\n'
      + 'jspm update                      Update all packages from package.json\n'
      + 'jspm uninstall name              Uninstall a package and clean dependencies\n'
      + 'jspm clean                       Clear unused and orphaned dependencies\n'
      + '\n'
      + 'jspm inspect [--forks]           View all installed package versions\n'
      + '  inspect [registry]:[package]   View the versions and ranges of a package\n'
      + '\n'
      //+ 'jspm inject <name[=target]> [--force] [--latest] [--lock] [-o]\n'
      //+ '  inject jquery                    Identical to install, but injects config\n'
      //+ '                                 only instead of downloading the package\n'
      + '\n'
      + 'jspm link <path> [package-name]  Symlink a local folder for development\n'
      + '\n'
      + 'jspm dl-loader [--edge --latest] Download the browser loader files\n'
      + '                                 Without any flags pins to stable SystemJS\n'
      + '\n'
      + 'jspm resolve --only registry:package@version\n'
      + '  resolve --only npm:util@0.10.3 Resolve all versions of a package to one version\n'
      + '\n'
      + 'jspm normalize pkg               Get the resolved path to a given module name\n'
      + 'jspm canonicalize pkg            Get the canonical name representation for a module\n'
      + '\n'
      + 'jspm bundle app.js + b [outfile] Create a named bundle to pre-populate the loader\n'
      + '  --minify --no-mangle --skip-source-maps --source-map-contents\n'
      + '  bundle x --config build.json   Use a custom config file for the build.\n'
      + '\n'
      + 'jspm bundle ./app.js --inject    Automatically load the named bundle when needed\n'
      + 'jspm unbundle                    Remove injected bundle configuration\n'
      + '\n'
      + 'jspm build main.js - x [outfile] Create an optimized static single-file build\n'
      + '  --skip-rollup                  Skip Rollup static optimizations\n'
      + '  --minify --no-mangle --config <build.json>       \n'
      + '  --format <amd|cjs|umd|esm>     Specify a custom output format for the build\n'
      + '  --format global --global-name <g> --global-deps "{globalModuleMap}"\n'
      + '\n'
      + 'jspm build ./x.js --format cjs   Statically optimize into a CommonJS build\n'
      + 'jspm build ./x.js - y            Statically build a global with a global dep\n'
      + '  --format global --global-name x --global-deps "{y:\'Y\'}"\n'
      + '\n'
      + 'jspm build ./x.js --node         Creates a Node-only build (default is browser)\n'
      + '\n'
      + 'jspm depcache moduleName         Stores dep cache in config for flat pipelining\n'
      + '\n'
      + 'jspm registry <command>          Manage registries\n'
      + '  registry config <name>         Configure an existing registry\n'
      + '  registry create <name> <pkg>   Create a new custom registry instance\n'
      // + '  registry export <registry-name>  Export an registry programatically\n'
      + '\n'
      + 'jspm config <option> <setting>   Configure jspm global options\n'
      + '                                 Stored in ~/.jspm/config\n'
      + '\n'
      + 'jspm cache-clear                 Clear global caches, not recommended\n'
      + '\n'
      + 'Global Flags\n'
      + ' --yes | -y                      Skip prompts / use default inputs\n'
      + ' --log <ok|warn|err>             Set log level\n'
      + ' --cwd [path]                    Set the working directory\n'
    );
  }

  function showVersion() {
    // deprecate localJspm
    ui.log(require('./package.json').version + '\n'
      + (process.env.globalJspm === 'true' || process.env.localJspm === 'false' ? 'Running against global jspm install.' : 'Running against local jspm install.'));
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

  // [].concat() to avoid mutating the given process.argv
  var args = process.argv.slice(2),
      options;

  var logArgIndex = args.indexOf('--log');
  if (logArgIndex > -1) {
    ui.setLogLevel(args[logArgIndex + 1]);
    args.splice(logArgIndex, 2);
  }

  var cwdArgIndex = args.indexOf('--cwd');
  if (cwdArgIndex > -1) {
    args.splice(cwdArgIndex, 2);
  }

  function readJSON(fileOrJSON, supportFile, dottedProperties) {
    if (fileOrJSON.trim() == '')
      return {};
    
    if (fileOrJSON.startsWith('{'))
      return eval('(' + fileOrJSON + ')');

    else if (fileOrJSON.indexOf('=') != -1)
      return readPropertySetters(fileOrJSON, dottedProperties);

    if (!supportFile)
      return ui.log('err', 'Invalid data option `' + fileOrJSON + '`. Provide JSON with `{...}` syntax or a list of property expressions with `=`.');

    var json;
    try {
      json = fs.readFileSync(fileOrJSON).toString();
    }
    catch(e) {
      return ui.log('err', 'Unable to read config file %' + fileOrJSON + '%.');
    }
    try {
      return JSON.parse(json);
    }
    catch(e) {
      return ui.log('err', 'Invalid JSON in config file %' + fileOrJSON + '%.');
    }
  }

  switch(args[0]) {
    case 'run':
      options = readOptions(args, ['view', 'production']);
      core.run(args[1], options.view, options.production)
      .catch(function() {
        process.exit(1);
      });
      break;

    case 'inject':
      var inject = true;

    case 'u':
    case 'update':
      var doUpdate = !inject;

    case 'i':
    case 'isntall':
    case 'install':
      options = readOptions(args, ['force', 'yes', 'lock', 'latest', 'exact',
                                   'unlink', 'quick', 'dev', 'save-dev', 'edge', 'production', 'peer'], ['override']);

      if (options['save-dev']) {
        ui.log('warn', 'The %--save-dev% install flag in jspm is just %--dev%.');
        options.dev = true;
      }

      options.inject = inject;
      options.update = doUpdate;

      args = options.args;

      var depMap;
      for (var i = 1; i < args.length; i++) {
        depMap = depMap || {};
        var name, target;
        var arg = args[i];
        name = arg.split('=')[0];
        target = arg.split('=')[1];

        if (!target) {
          target = name;
          if (name.indexOf(':') !== -1)
            name = name.substr(name.indexOf(':') + 1);
          if (name.lastIndexOf('@') > 0)
            name = name.substr(0, name.lastIndexOf('@'));
          else if (name[0] == '/' || name[0] == '.')
            return ui.log('err', 'Target %' + name + '% looks like a file path not a package.' + (args.length == 2 ? '\nDid you mean %jspm link ' + name + '%?' : ''));
        }

        if (target.indexOf(':') === -1)
          target = globalConfig.config.defaultRegistry + ':' + target;

        depMap[name] = target || '';
      }

      if ('override' in options)
        options.override = readJSON(options.override, true, true);

      if (options.yes)
        ui.useDefaults();

      // no install package -> install from package.json dependencies
      (depMap ? install.install(depMap, options) : install.install(true, options))
      .then(function() {
        return core.checkDlLoader();
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
      options = readOptions(args, ['yes', 'peer']);

      if (options.yes)
        ui.useDefaults();

      install.uninstall(options.args.splice(1), options.peer)
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
      options = readOptions(args, null, ['only']);

      if (!options.only)
        return ui.log('warn', 'Use %jspm resolve --only registry:pkg@version%');

      install.resolveOnly(options.only)
      .catch(function(err) {
        if (!err)
          ui.log('err', 'Resolve operation not performed.');
        else
          ui.log('err', err.stack || err);
        process.exit(1);
      });
      break;

    case 'prune':
    case 'clean':
      options = readOptions(args, ['yes']);
      args = options.args;

      if (options.yes)
        ui.useDefaults();

      install.clean(true)
      .then(function() {
        ui.log('');
        ui.log('ok', 'Project cleaned successfully.');
      }, function(err) {
        ui.log('err', err.stack || err);
        process.exit(1);
      });
      break;

    case 'inspect':
      options = readOptions(args, ['forks']);
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
        process.exit(1);
      });
      break;

    case 'init':
      options = readOptions(args, ['yes', 'prompts']);
      if (options.yes)
        ui.useDefaults();
      if (options.prompts)
        ui.log('warn', 'The %--prompts% / %-p% flag has been deprecated and is no longer necessary.');
      core.init(options.args[1])
      .catch(function(e) {
        console.log(e);
        process.exit(1);
      });
      break;

    case 'dl-loader':
      options = readOptions(args, ['source', 'latest', 'edge', 'yes']);
      if (options.yes)
        ui.useDefaults();
      if (['traceur', 'typescript', 'babel'].indexOf(options.args[1]) != -1) {
        ui.log('err', '%jspm dl-loader% no longer provides transpiler downloading.\n');
        ui.log('info', 'To set a transpiler use the init prompts %jspm init -p%.\n\n' + 
            'Alternatively manually install via %jspm install plugin-' + options.args[1] + '% and set this as the %transpiler% property in the jspm config.');
        break;
      }
      core.dlLoader(options.source, options.edge, options.latest);
      break;

    case 'canonicalize':
      var canonicalize = true;

    case 'normalize':
      options = readOptions(args, ['yes'], ['parent', 'browser', 'dev', 'production']);
      var env = {};
      if ('production' in options) {
        env.production = true;
        env.dev = false;
      }
      if ('browser' in options) {
        env.browser = true;
        env.node = false;
      }

      core.normalize(options.args[1], options.parent, canonicalize, env)
      .then(function(normalized) {
        console.log(normalized);
      })
      .catch(function(e) {
        ui.log('err', (e || e.stack).toString());
        process.exit(1);
      });
      break;

    case 'depcache':
      options = readOptions(args, ['yes']);
      if (options.yes)
        ui.useDefaults();
      if (!args[1])
        ui.log('warn', 'depCache requires a module name to trace.');
      else
        bundle.depCache(args[1]);
      break;

    case 'bundle-sfx':
      ui.log('err', '`bundle-sfx` has been renamed to `build`.\n\tUse %jspm build ' + args.splice(1).join(' ') + '%');
      break;
    case 'b':
    case 'build':
      var staticBuild = true;

    case 'bundle':
      options = readOptions(args, ['inject', 'yes', 'skip-source-maps', 'minify',
          'no-mangle', 'hires-source-maps', 'no-runtime', 'inline-source-maps', 'source-map-contents', 
          'browser', 'node', 'dev', 'production', 'skip-encode-names', 'skip-rollup', 'watch'],
          ['format', 'global-name', 'globals', 'global-deps', 'global-defs', 'config', 'conditions', 'externals']);

      if (options.yes)
        ui.useDefaults();
      options.sourceMaps = !options['skip-source-maps'];
      options.lowResSourceMaps = !options['hires-source-maps'];
      options.mangle = !options['no-mangle'];
      options.sourceMapContents = !!options['source-map-contents'];
      options.injectConfig = !!options.inject;

      if (options['inline-source-maps'])
        options.sourceMaps = 'inline';

      if (options['global-name']) {
        options.globalName = options['global-name'];
      }

      if (options.externals) {
        options.externals = options.externals.split(' ').map(function(item) {
          return item.trim();
        });
      }

      if (options['global-deps']) {
        // globalDeps are by default externals
        options.globalDeps = readJSON(options['global-deps'], false, false);
        options.externals = (options.externals || []).concat(Object.keys(options.globalDeps).filter(function(global) {
          return !options.externals || options.externals.indexOf(global) == -1;
        }));
      }

      if (options.globals) {
        ui.log('warn', 'The %--globals% option has been renamed to %--global-deps%.');
        options.globalDeps = readJSON(options.globals, false, false);
      }

      if (options['global-defs'])
        options.globalDefs = readJSON(options['global-defs'], false, false);

      if (options['skip-encode-names'])
        options.encodeNames = !options['skip-encode-names'];

      if (options['skip-rollup'])
        options.rollup = !options['skip-rollup'];

      if (options.dev)
        options.development = true;

      if (options.config)
        options.config = readJSON(options.config, true, true);

      if (options.conditions)
        options.conditions = readJSON(options.conditions, false, false);

      var bArgs = options.args.splice(1);

      if (bArgs.length === 0)
        return ui.log('warn', 'You must provide at least one module as the starting point for bundling');

      if (options.format && options.format.match(/es.?/) && options.minify) // remove this on resolution of https://github.com/systemjs/builder/issues/726
        return ui.log('warn', 'The %--minify% option is currently not compatible with %--format ' + options.format + '%, consider specifying a different format or skipping minification');

      if (bArgs.length < 2) {
        (staticBuild ? bundle.build : bundle.bundle)(bArgs[0], undefined, options)
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
        (staticBuild ? bundle.build : bundle.bundle)(expression, fileName, options)
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

    case 'link':
      options = readOptions(args, ['force', 'yes', 'quick', 'dev', 'peer']);

      if (options.yes)
        ui.useDefaults();

      args = options.args;

      if (!args[1]) {
        ui.log('err', 'You must provide a local path to a folder to jspm link.\n     %jspm link ../folder%.');
        break;
      }

      link.link(args[1], args[2], options);
      break;

    case 'registry':
      options = readOptions(args, ['yes']);

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
      var value = readValue(args.splice(2).join(' '));
      if(!(property && value)){
        ui.log('warn', 'jspm config requires a property and value via %jspm config property value%');
        break;
      }
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
