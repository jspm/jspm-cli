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
var path = require('path');
var fs = require('fs');

/*
 * Configuration base class
 * For creating and managing configurations which sync to files
 */
module.exports = ConfigFile;

function ConfigFile(fileName) {
  this.fileName = path.resolve(fileName);
  
  // configuration file style is detected when loading
  this.style = null;

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

function configError(memberArray, msg) {
  throw new TypeError('Error reading %' + path.relative(this.fileName, process.cwd()) + '%\n\t`' + memberArray.join('.') + '` ' + msg + '.');
}

// returns a property object for a given key from the property list
// returns undefined if not found
// properties is already assumed to be an array
function getProperty(properties, key) {
  var value;
  properties.some(function(prop) {
    if (prop.key == key) {
      value = prop.value;
      return true;
    }
  });
  return value;
}

// adds the new property to the given properties object
// if the property exists, it is updated to the new value
// if not the property is placed at the first appropriate position alphabetically
// returns true when an actual change is made
function setProperty(properties, key, value) {
  var changed = false;
  if (properties.some(function(prop) {
    if (prop.key == key) {
      if (prop.value !== value)
        changed = true;
      prop.value = value;
      return true;
    }
  }))
    return changed;

  // find best alphabetical position
  if (!properties.some(function(prop, index) {
    if (prop.key > key) {
      properties.splice(index, 0, {
        key: key,
        value: value
      });
      return true;
    }
  }))
    properties.push({
      key: key,
      value: value
    });
}

// only applies to values
// Returns undefined for no value
// throws if an object, with a fileName reference
// member lookups not in objects throw
ConfigFile.prototype.getValue = function(memberArray) {
  var properties = this.properties;
  var self = this;
  memberArray.some(function(member, index) {
    if (!(properties instanceof Array))
      configError.call(self, memberArray.splice(0, index), 'should be an object');

    properties = getProperty(properties, member);

    if (!properties)
      return true;
  });
  
  if (properties instanceof Array)
    configError.call(this, memberArray, 'should be a value not an object');
  
  return properties && properties.value;
};

// returns properties array
// If not a properties array, returns undefined
// if a value, throws
// createIfUndefined will create and return an empty object at that location
// setting changed: true in the process if necessary
// otherwise we just return undefined if not found
// member lookups not in objects throw
ConfigFile.prototype.getProperties = function(memberArray, createIfUndefined) {
  var properties = this.properties;
  var self = this;
  memberArray.some(function(member, index) {
    var value = getProperty(properties, member);
    if (createIfUndefined && !value) {
      properties.push(value = []);
      self.changed = true;
    }

    properties = value;

    if (!properties)
      return true;

    if (!(properties instanceof Array))
      configError.call(self, memberArray.splice(0, index + 1), 'should be an object');
  });
  return properties;
}

// returns properties array as a readable JS object of values.
// Nested objects throw nice error unless nested is set to true
ConfigFile.prototype.getObject = function(memberArray, nested) {
  var properties = this.getProperties(memberArray);
  if (!properties) {
    properties = [];
    this.setProperties(memberArray, properties);
  }
  
  var obj = propertiesToObject(properties);
  
  Object.keys(obj).forEach(function(key) {
    if (typeof obj[key] == 'object' && obj[key] !== null)
      configError.call(this, memberArray, 'should not contain a nested object at "' + key + '"');
  });
  
  return obj;
};
function propertiesToObject(properties) {
  var obj = {};
  properties.forEach(function(p) {
    var prop = p.key;
    var val = p.value;

    if (val instanceof Array)
      obj[prop] = propertiesToObject(val, true);
    else
      obj[prop] = val.value;
  });
  return obj;
}

function objectToProperties(obj) {
  var properties = [];
  Object.keys(obj).forEach(function(key) {
    var value = obj[key];
    if (typeof value == 'object')
      value = objectToProperties(value);
    properties.push({
      key: key,
      value: value
    });
  });
  return properties;
}

ConfigFile.prototype.has = function(memberArray) {
  var curProperties = this.properties;
  memberArray = memberArray.concat([]);
  var finalMember = memberArray.pop();
  memberArray.some(function(member) {
    if (!curProperties || !(curProperties instanceof Array))
      return true;
    curProperties = getProperty(curProperties, member);
  });
  if (curProperties && curProperties instanceof Array)
    return getProperty(curProperties, memberArray) !== undefined;
  return false;
};

// sets this.changed if a change
// retains property ordering
// overwrites anything already existing
ConfigFile.prototype.setValue = function(memberArray, value) {
  var properties = this.properties;
  var self = this;

  memberArray.splice(0, memberArray.length - 1).some(function(member, index) {
    if (!(properties instanceof Array))
      configError.call(self, memberArray.splice(0, index), 'should be an object');

    var value = getProperty(properties, member);
    if (!value) {
      properties.push(value = []);
      self.changed = true;
    }

    properties = value;
  });
  
  if (!(properties instanceof Array))
    configError.call(this, memberArray, 'should be an object');

  if (setProperty(properties, memberArray[memberArray.length - 1], value))
    this.changed = true;
};

// handles nested objects, memberArray can be 0 length for base-level population
// where target object already exists, it overwrites retaining the same ordering
// default behaviour is to not write empty objects, but to also not clear objects made empty
ConfigFile.prototype.setProperties = function(memberArray, properties, clearIfEmpty) {
  var targetProperties = this.getProperties(memberArray, true);

  var self = this;

  var setKeys = [];
  properties.forEach(function(prop) {
    setKeys.push(prop.key);
    if (setProperty(targetProperties, prop.key, prop.value))
      self.changed = true;
  });

  targetProperties.forEach(function(prop, index) {
    if (setKeys.indexOf(prop.key) == -1)
      targetProperties.splice(index, 1);
  });
};

// only clears on empty if not already existing as empty
// sets this.changed, retains ordering and overwrites as with setValue
ConfigFile.prototype.setObject = function(memberArray, obj, clearIfEmpty) {
  // convert object into a properties array
  this.setProperties(memberArray, objectToProperties(obj), clearIfEmpty);
};

// default serialization is as a JSON file, but these can be overridden
ConfigFile.prototype.serialize = function(obj) {
  var jsonString = JSON.stringify(obj, null, this.style.tab);

  if (this.style.trailingNewline)
    jsonString += this.style.newline;

  return jsonString
      .replace(/([^\\])"/g, '$1' + this.style.quote)
      .replace(/\n/g, this.style.newline);
};
ConfigFile.prototype.deserialize = function(source) {
  return JSON.parse(source.replace(/([^\\])'/g, '$1"'));
};

// read and write are sync functions
ConfigFile.prototype.read = function() {
  this.timestamp = fs.statSync(this.fileName).mtime.getTime();
  var contents = fs.readFileSync(this.fileName).toString();

  this.style = detectStyle(contents);

  this.setObject([], this.deserialize(contents));
};
ConfigFile.prototype.write = function() {
  if (this.beforeWrite)
    this.beforeWrite();

  var timestamp = fs.statSync(this.fileName).mtime.getTime();

  if (timestamp !== this.timestamp)
    throw new Error('Configuration file ' + this.fileName + ' has been modified by another process.');

  fs.writeFileSync(this.fileName, this.serialize(this.getObject([], true)));

  this.timestamp = fs.statSync(this.fileName).mtime.getTime();
};

function detectStyle(string) {
  var style = {
    tab: '  ',
    newline: '\n',
    trailingNewline: true,
    quote: '"'
  };

  var tabMatch = string.match(/ |\t/);
  if (tabMatch)
    style.tab = tabMatch[0];

  var newLineMatch = string.match(/\r\n|\n|\r/);
  if (newLineMatch)
    style.newLine = newLineMatch[0];

  var quoteMatch = string.match(/"|'/);
  if (quoteMatch)
    style.quote = quoteMatch[0];

  if (!string.match(/\n$/))
    style.trailingNewline = false;

  return style;
};