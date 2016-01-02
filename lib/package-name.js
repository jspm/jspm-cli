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
function Package(name, escape) {
  if (name.indexOf(':') !== -1)
    this.registry = name.split(':')[0];
  else
    this.registry = '';

  var pkg = this.registry ? name.substr(this.registry.length + 1) : name;

  var versionIndex = pkg.lastIndexOf('@');
  var version = '';

  if (versionIndex !== -1 && versionIndex !== 0) {
    version = pkg.substr(versionIndex + 1);
    pkg = pkg.substr(0, versionIndex);
  }

  if (escape && version)
    version = version.replace(/[\/%]/g, function(symbol) {
      return encodeURIComponent(symbol);
    });

  this.package = pkg;
  this.setVersion(version);
}

// sets name, exactName, exactPackage from registry, package, version
function setDerivedProperties(pkg) {
  var v = pkg.version ? '@' + pkg.version : '';
  pkg.name = (pkg.registry ? pkg.registry + ':' : '') + pkg.package;
  pkg.exactPackage = pkg.package + v;
  pkg.exactName = pkg.name + v;
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

var path = require('path');
var config = require('./config');
Package.prototype.getPath = function(packagesFolder) {
  return path.resolve(packagesFolder || config.pjson.packages, this.registry, this.exactPackage);
};

Package.prototype.toString = function() {
  return this.exactName;
};

module.exports = Package;
