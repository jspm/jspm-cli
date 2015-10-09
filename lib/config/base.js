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

var extend = require('../common').extend;

/*
 * Configuration base class
 * For creating and managing configurations which sync to files
 */
module.exports = Config;

var defaultStyle = {
  tab: '  ',
  newline: '\n',
  trailingNewline: true,
  quote: '"'
};

function Config(fileName) {
  this.fileName = fileName;
  
  // configuration file style is detected when loading
  this.style = extend({}, defaultStyle);

  // we note the configuration file timestamp
  this.timestamp = null;

  // properties are stored as an ordered array of { key, value } pairs
  // nested objects are in turn array values
  // value properties are { value } objects
  this.properties = [];

  // we only need to write if the file has actually changed
  this.changed = false;

  this.read();
}

function findProperty(name, properties) {
  var curValue;
  properties.some(function(p) {
    curValue = p.value;
    return p.key == name;
  });
  return curValue;
}

Config.prototype.set = function(memberArray, value) {
  // TODO: complete
  // detects if changed needs to be set
  var properties = this.properties;
  memberArray.forEach(function(member) {
    properties = findProperty(member, properties);
  });
  properties = value;
  return true;
};

Config.prototype.setIfExists = function(memberArray, value) {
  // TODO: complete
  return this.set(memberArray, value);
};

Config.prototype.get = function(memberArray) {
  // TODO: complete
  var properties = this.properties;
  memberArray.forEach(function(member) {
    properties = findProperty(member, properties);
  });
  return properties;
};

Config.prototype.add = function(parentMemberArray, name, value) {
  // TODO: complete
  // detects if changed needs to be set
  var properties = this.properties;
  parentMemberArray.forEach(function(member) {
    properties = findProperty(member, properties);
  });
  properties.push({ key: name, value: value });
  return true;
};

Config.prototype.remove = function(memberArray) {
  // TODO: complete
  var properties = this.properties;
  memberArray.forEach(function(member) {
    properties = findProperty(member, properties);
  });
  return true;
};



// default serialization is as a JSON file, but these can be overridden
Config.prototype.serialize = function() {
  var jsonString = JSON.stringify(Config.getSerializedObject(this.properties), null, this.style.tab);

  if (this.style.trailingNewline)
    jsonString += this.style.newline;

  return jsonString
      .replace(/"/g, this.style.quote)
      .replace(/\n/g, this.style.newline);
};
Config.prototype.deserialize = function(source) {
  return JSON.parse(source);
};

// read and write are sync functions
Config.prototype.read = function() {
  // TODO
};
Config.prototype.write = function() {
  // TODO
  // will check no writes since last read, and throw otherwise
};

Config.getSerializedObject = function(properties) {
  var obj = {};
  properties.forEach(function(p) {
    var prop = p.key;
    var val = p.value;

    if (val instanceof Array)
      obj[prop] = Config.getSerializedObject(val);
    else 
      obj[prop] = val.value;
  });
  return obj;
};

Config.detectStyle = function(string) {
  // TODO
  var style = extend({}, defaultStyle);

  style.trailingNewline = string.match(/\n$/);

  return style;
};