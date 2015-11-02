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
  if (arguments.length == 1) {
    msg = memberArray;
    memberArray = [];
  }
  throw 'Error reading ' + path.relative(process.cwd(), this.fileName)
      + '\n\t' + (memberArray.length ? '%' + memberArray.join('.') + '% ' : 'File ') + msg + '.';
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
// type is optional, and can be 'array', 'number', 'boolean', 'string' to add simple type checking
ConfigFile.prototype.getValue = function(memberArray, type) {
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

  if (!properties)
    return;

  var value = properties.value;

  if (type == 'array' && !(value instanceof Array) || (type && type != 'array' && typeof value != type))
    configError.call(this, memberArray, 'must be a' + (type == 'array' ? 'n ' : ' ') + type + ' value');
  
  return value;
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
      properties.push({ key: member, value: value = [] });
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
// if the object does not exist, returns undefined
// if the property corresponds to a value, throws
ConfigFile.prototype.getObject = function(memberArray, nested, createIfUndefined) {
  var properties = this.getProperties(memberArray);
  if (!properties) {
    if (!createIfUndefined)
      return;
    properties = [];
    this.setProperties(memberArray, properties);
  }
  
  var obj = propertiesToObject(properties);
  
  var self = this;
  if (!nested)
    Object.keys(obj).forEach(function(key) {
      if (typeof obj[key] == 'object' && obj[key] !== null)
        configError.call(self, memberArray, 'should not contain a nested object at %' + key + '%');
    });
  
  return obj;
};
function propertiesToObject(properties) {
  var obj = {};
  properties.forEach(function(p) {
    var prop = p.key;
    var val = p.value;

    if (val instanceof Array)
      obj[prop] = propertiesToObject(val);
    else
      obj[prop] = val.value;
  });
  return obj;
}

function objectToProperties(obj) {
  var properties = [];
  Object.keys(obj).forEach(function(key) {
    var value = obj[key];
    if (typeof value == 'object' && !(value instanceof Array))
      value = objectToProperties(value);
    else
      value = { value: value };
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
    return getProperty(curProperties, [finalMember]) !== undefined;
  return false;
};

// removes the given property member name if it exists
ConfigFile.prototype.remove = function(memberArray) {
  var curProperties = this.properties;
  memberArray = memberArray.concat([]);
  var finalMember = memberArray.pop();
  memberArray.some(function(member) {
    if (!curProperties || !(curProperties instanceof Array))
      return true;
    curProperties = getProperty(curProperties, member);
  });
  if (curProperties && curProperties instanceof Array) {
    curProperties.some(function(prop, index) {
      if (prop.key == finalMember) {
        curProperties.splice(index, 1);
        return true;
      }
    });
  }
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

  if (setProperty(properties, memberArray[memberArray.length - 1], { value: value }))
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

  if (clearIfEmpty && targetProperties.length == 0)
    this.remove(memberArray);
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
  var contents;
  try {
    this.timestamp = fs.statSync(this.fileName).mtime.getTime();
    contents = fs.readFileSync(this.fileName).toString();
  }
  catch(e) {
    if (e.code != 'ENOENT')
      throw e;

    this.timestamp = -1;
    contents = '';
  }

  this.style = detectStyle(contents);

  try {
    var deserializedObj = this.deserialize(contents) || {};
  }
  catch(e) {
    configError.call(this, e.toString());
  }

  this.setObject([], deserializedObj);
};
ConfigFile.prototype.write = function() {
  if (this.beforeWrite)
    this.beforeWrite();

  var timestamp;
  try {
    timestamp = fs.statSync(this.fileName).mtime.getTime();
  }
  catch(e) {
    if (e.code != 'ENOENT')
      throw e;

    timestamp = -1;
  }

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

  var newLineMatch = string.match(/\r\n|\n|\r/);
  if (newLineMatch)
    style.newline = newLineMatch[0];

  // best-effort tab detection
  // yes this is overkill, but it avoids possibly annoying edge cases
  var tabSpaces = string.match(/^\s+/mg) || [];
  var tabDifferenceFreqs = {};
  var lastLength = 0;
  tabSpaces.forEach(function(tabSpace) {
    var diff = Math.abs(tabSpace.length - lastLength);
    if (diff != 0)
      tabDifferenceFreqs[diff] = (tabDifferenceFreqs[diff] || 0) + 1;
    lastLength = tabSpace.length;
  });
  var bestTabLength = undefined;
  Object.keys(tabDifferenceFreqs).forEach(function(tabLength) {
    if (!bestTabLength || tabDifferenceFreqs[tabLength] >= tabDifferenceFreqs[bestTabLength])
      bestTabLength = tabLength;
  });
  // having determined the most common spacing difference length, 
  // generate samples of this tab length from the end of each line space
  // the most common sample is then the tab string
  var tabSamples = {};
  tabSpaces.forEach(function(tabSpace) {
    var sample = tabSpace.substr(tabSpace.length - bestTabLength);
    tabSamples[sample] = (tabSamples[sample] || 0) + 1;
  })
  var bestTabSample;
  Object.keys(tabSamples).forEach(function(sample) {
    if (!bestTabSample || tabSamples[sample] > tabSamples[bestTabSample])
      bestTabSample = sample;
  });
  
  if (bestTabSample)
    style.tab = bestTabSample;

  var quoteMatch = string.match(/"|'/);
  if (quoteMatch)
    style.quote = quoteMatch[0];

  if (!string.match(new RegExp(style.newLine + '$')))
    style.trailingNewline = false;

  return style;
};