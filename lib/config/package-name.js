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

/*
  Parse a package name into endpoint:package@version

  name: 'github:jquery/jquery',
  exactName: 'github:jquery/jquery@2.0.3',
  exactPackage: 'jquery/jquery@2.0.3',

  endpoint: 'github',
  package: 'jquery/jquery',
  version: '2.0.3'
*/
function Package(name) {
  this.exactName = name;

  if (name.indexOf(':') != -1)
    this.endpoint = name.split(':')[0];

  var packageParts = (this.endpoint ? name.substr(this.endpoint.length + 1) : name).split('/');

  var versionSplit = (packageParts[packageParts.length - 1] || '').split('@');

  var version = versionSplit[1] || '';

  packageParts[packageParts.length - 1] = versionSplit[0];
  this.package = packageParts.join('/');

  this.name = (this.endpoint ? this.endpoint + ':' : '') + this.package;

  this.setVersion(version);
}
Package.prototype.setVersion = function(version) {
  this.version = version;
  var v = this.version ? '@' + this.version : '';
  this.exactPackage = this.package + v;
  this.exactName = this.name + v;
}
Package.prototype.setEndpoint = function(endpoint) {
  if (this.endpoint)
    throw 'Endpoint already set.';
  this.endpoint = endpoint;
  this.exactName = endpoint + ':' + this.exactName;
  this.name = endpoint + ':' + this.name;
}
Package.prototype.write = function() {
  return this.exactName;
}
module.exports = Package;