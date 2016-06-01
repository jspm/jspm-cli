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
/*
  Parse a package name into registry:package@version

  name: 'github:jquery/jquery',
  exactName: 'github:jquery/jquery@2.0.3',
  exactPackage: 'jquery/jquery@2.0.3',

  registry: 'github',
  package: 'jquery/jquery',
  version: '2.0.3'
*/
module.exports = Package;

var path = require('path');

function Package(name, escaped) {
  // (never detect :// protocol specifier as a registry to allow protocol maps)
  if (name.indexOf(':') == -1 || name.split(':')[1].substr(0, 2) == '//') {
    this.registry = '';
    this.name = name;
    return;
  }

  this.registry = name.split(':')[0];

  var pkg = name.substr(this.registry.length + 1);

  var versionIndex = pkg.lastIndexOf('@');
  var version = '';

  if (versionIndex !== -1 && versionIndex !== 0) {
    version = pkg.substr(versionIndex + 1);
    pkg = pkg.substr(0, versionIndex);
  }

  this.package = pkg;

  // if escaped and version contains / then this is a custom map into a package subpath
  if (escaped && version.indexOf('/') != -1) {
    this.registry = '';
    this.name = name;
    return;
  }

  if (escaped)
    version = version.replace(/\%25|\%2F/g, function(encoding) {
      if (encoding == '%25')
        return '%';
      if (encoding == '%2F')
        return '/';
    });

  this.setVersion(version);
}

// sets name, exactName, exactPackage from registry, package, version
function setDerivedProperties(pkg) {
  var v = pkg.version ? '@' + pkg.version : '';
  pkg.name = (pkg.registry ? pkg.registry + ':' : '') + pkg.package;
  pkg.exactPackage = pkg.package + v;
  pkg.exactName = pkg.name + v;
  pkg.exactNameEncoded = pkg.name + pkg.getEncodedVersion();
}

Package.prototype.setVersion = function(version) {
  this.version = version == '*' ? '' : version;
  setDerivedProperties(this);
  return this;
};

Package.prototype.setRegistry = function(registry) {
  this.registry = registry;
  setDerivedProperties(this);
  return this;
};

Package.prototype.setPackage = function(name) {
  this.package = name;
  setDerivedProperties(this);
  return this;
};

Package.prototype.copy = function() {
  return new Package(this.exactName);
};

Package.prototype.getPath = function(packagesFolder) {
  var config = require('./config');
  return path.resolve(packagesFolder || config.pjson.packages, this.registry, this.package + this.getEncodedVersion());
};

Package.prototype.getEncodedVersion = function() {
  if (!this.version)
    return '';
  return '@' + this.version.replace(/[\/%]/g, function(symbol) {
    return encodeURIComponent(symbol);
  });
};

Package.prototype.toString = function() {
  return this.name + this.getEncodedVersion();
};
