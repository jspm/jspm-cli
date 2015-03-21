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

var ui = require('./ui');

exports.overridePrompts = function(pkg, pjson) {
  var override = {};

  return Promise.resolve()
  // directories.lib
  .then(function() {
    return ui.confirm('Would you like to install only a subdirectory from the package?', false);
    .then(function(subdir) {
      if (subdir)
        return ui.input('Enter a subdirectory to install', pjson.directories && pjson.directories.lib)
        .then(function(subdir) {
          subdir = sanitizeFileInput(subdir);
          if (subdir.substr(0, 1) == './')
            subdir = subdir.subtr(2);
          override.directories = { lib: subdir };
        });
    });
  })

  // files, ignore
  .then(function() {
    return ui.confirm('Would you like to specify files or folders to only include or ignore?', false)
    .then(function(filesIgnore) {

      if (filesIgnore) {
        if (pjson.files)
          ui.log('info', 'Currently the files included are only %' + pjson.files.join('%, %') + '%.');
        return ui.input('Enter a comma-separated list of files or folders to include (optional)')
        .then(function(files) {
          if (files) {
            files = files.split(',').map(sanitizeFileInput);
            override.files = files;
          }
          return filesIgnore;
        });
      }
    })
    .then(function(filesIgnore) {
      if (filesIgnore) {
        if (pjson.ignore)
          ui.log('info', 'Current ignoring %' + pjson.ignore.join('%, %') + '%.');
        return ui.input('Enter a comma-separated list of files or folders to ignore (optional)')
        .then(function(files) {
          files = files.split(',').map(sanitizeFileInput);
          override.ignore = files;
        });
      }
    });
  })

  // module format
  .then(function() {
    return ui.confirm('Would you like to enforce a single module format for all modules instead of automatic detection?', false)
    .then(function(format) {
      if (format)
        return ui.input('Enter a module format (es6, amd, cjs, global)', pjson.format)
        .then(function(moduleFormat) {
          if (moduleFormat) {
            moduleFormat = moduleFormat.toLowerCase();
            override.format = moduleFormat;
          }
        });
    });
  })

  // main entry point
  .then(function() {
    return ui.confirm('Would you like to override the main entry point?', false)
    .then(function(main) {
      if (main)
        return ui.input('Enter a main entry point relative to the base package path', pjson.main)
        .then(function(main) {
          main = sanitizeFileInput(main);
          override.main = main;
        });
    });
  })

  // registry
  .then(function() {
    if (pjson.registry == 'npm')
      return ui.confirm('Would you like to disable Node conversion of this package (not recommended)?\n'
          + '(interpret modules and dependencies in jspm style, disable Node require features like directory require, js extension and JSON require support etc)?', pjson.jspmNodeConversion === false)
      .then(function(disableNpm) {
        if (disableNpm)
          override.jspmNodeConversion = false;
      });
    if (pkg.endpoint == 'github')
      return ui.log('info', 'Are you sure this package won\'t work installed through the npm registry endpoint?', true)
      .then(function(invalid) {
        return Promise.reject('Please try `jspm install npm:' + pkg.package.split('/').pop()) + '` first.';
      });
  })

  // shim
  .then(function() {
    return ui.input('Would you like to specify the dependencies and exports for any global modules (shim config)?', false)
    .then(function(shim) {
      if (shim)
        return addShim({})
        .then(function(shim) {
          override.shim = shim;

          var externalShimDeps = [];
          shim.forEach(function(curShim) {
            curShim.deps.forEach(function(dep) {
              if (dep.substr(0, 1) != '.' && externalShimDeps.indexOf(dep) == -1)
                externalShimDeps.push(dep);
            });
          });

          var shimDependencies = {};
          return Promise.all(externalShimDeps.map(dep) {
            return ui.input('Enter the canonical package name for dependency `' + dep + '` (%registry:package@^version%')
          });
        });
    });

    function addShim(shim) {
      var curShim = {};

      return Promise.resolve()
      .then(function() {
        return ui.input('Enter the file path to shim relative to the base package path.\n'
            + '(single-level wildcards are supported)');
      })
      .then(function(_shimFile) {
        shimFile = sanitizeFileInput(_shimFile)
        if (shimFile.substr(0, 2) == './')
          shimFile = shimFile.substr(2);
        if (shimFile.substr(shimFile.length - 3, 3) == '.js')
          shimFile = shimFile.substr(0, shimFile.length - 3);

        shim[shimFile] = curShim;
        
        return ui.input('Enter any comma-separated dependencies of the module.\n'
            + '(relative deps are relative to the module itself)')
      })
      .then(function(deps) {
        curShim.deps = deps.split(',').map(function(dep) {
          return dep.trim();
        });
        if (!curShim.deps.length)
          delete curShim.deps;
      })
      .then(function() {
        return ui.input('Enter the name of the global value the module export should be (optional)');
      })
      .then(function(exports) {
        if (exports)
          curShim.exports = exports;
        return ui.confirm('Would you like to add another shim?');
      })
      .then(function(addShim) {
        if (addShim)
          return addShim(shim);
        return shim;
      });
    }
  })

  // dependencies
  .then(function() {
    return ui.confirm('Would you like to specify the package dependencies?', false)
    .then(function(dependencies) {
      if (dependencies)
        return addDependency({})
        .then(function(dependencies) {
          override.registry = 'jspm';
          override.dependencies = dependencies;
        });
    })
    // we could even check if the package dependencies are "valid" jspm dependencies
    // if we had methods to verify packages based on some statistical analysis
    // to be able to know what packages work well with jspm to a probability
    // then we could flag up modules that we know are likely not to work and warn users upfront
    // this would alleviate a big frustration where a dependency obviously won't install
    // but the user doing the install doesn't know that and then wastes time not knowing the issue
    .then(function(dependencies) {
    })
  })

  .then(function() {
    ui.log('info', '');
    ui.log('info', 'Override Contents:');
    ui.log('There are also override options for dependencies and map. Create a manual override file to set these properties');
  })

  .then(function() {
    return override;
  });
};

function sanitizeFileInput(file) {
  return file.replace(/\\/g, '/').trim();
}

function validateDependency(dependency) {
  // etc etc
  ui.log('warn', 'You probably want to include a version');
}
