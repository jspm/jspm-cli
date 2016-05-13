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

var path = require('path');
var fs = require('fs');
var mkdirp = require('mkdirp');

/*
 * Configuration base class
 * For creating and managing configurations which sync to files
 */
module.exports = ConfigFile;

function ConfigFile(fileName, ordering) {
  this.fileName = path.resolve(fileName);

  this.ordering = ordering;
  
  // configuration file style is detected when loading
  this.style = null;

  // we note the configuration file timestamp
  this.timestamp = null;

  // properties are stored as an ordered array of { key, value } pairs
  // nested objects are in turn array values
  // value properties are { value } objects
  this.properties = [];

  // allow adding change events
  this.changeEvents = [];

  // we only need to write if the file has actually changed
  this.changed = false;

  this.read();
}

function configError(memberArray, msg) {
  if (arguments.length == 1) {
    msg = memberArray;
    memberArray = [];
  }
  throw new TypeError('Error reading %' + path.relative(process.cwd(), this.fileName) + '%\n\t' + 
      (memberArray.length ? '%' + memberArray.join('.') + '% ' : 'File ') + msg + '.');
}

function propertyEquals(propA, propB) {
  if (propA instanceof Array || propB instanceof Array) {
    if (!(propA instanceof Array && propB instanceof Array))
      return false;

    if (propA.length != propB.length)
      return false;

    return !propA.some(function(itemA, index) {
      var itemB = propB[index];
      return itemA.key != itemB.key || !propertyEquals(itemA.value, itemB.value);
    });
  }
  else {
    return propA.value === propB.value;
  }
}

// adds the new property to the given properties object
// if the property exists, it is updated to the new value
// if not the property is placed at the first appropriate position alphabetically
// returns true when an actual change is made
// ordering is an array representing the property order suggestion, to use to apply ordering algorithm
function setProperty(properties, key, value, ordering) {
  var changed = false;
  if (properties.some(function(prop) {
    if (prop.key == key) {
      // determine equality
      if (!propertyEquals(prop.value, value))
        changed = true;
      prop.value = value;
      return true;
    }
  }))
    return changed;

  if (!ordering || !ordering.length) {
    properties.push({
      key: key,
      value: value
    });
    return true;
  }

  // apply ordering algorithm
  var orderIndex = orderingIndex(ordering, key);

  // find the max and minimum index in this property list given the ordering spec
  var maxOrderIndex = properties.length, minOrderIndex = 0;
  if (orderIndex != -1)
    properties.forEach(function(prop, index) {
      // get the ordering index of the current property
      var propOrderIndex = orderingIndex(ordering, prop.key);
      if (propOrderIndex != -1) {
        if (propOrderIndex < orderIndex && index + 1 > minOrderIndex && index < maxOrderIndex)
          minOrderIndex = index + 1;
        if (propOrderIndex > orderIndex && index < maxOrderIndex && index >= minOrderIndex)
          maxOrderIndex = index;
      }
    });

  // within the ordering range, use alphabetical ordering
  orderIndex = -1;
  for (var i = minOrderIndex; i < maxOrderIndex; i++)
    if (properties[i].key > key) {
      orderIndex = i;
      break;
    }

  if (orderIndex == -1)
    orderIndex = maxOrderIndex;

  properties.splice(orderIndex, 0, {
    key: key,
    value: value
  });

  return true;
}

// returns a property object for a given key from the property list
// returns undefined if not found
// properties is already assumed to be an array
function getProperty(properties, key) {
  var propMatch = {
    index: -1,
    property: undefined
  };
  properties.some(function(prop, index) {
    if (prop.key == key) {
      propMatch = {
        property: prop,
        index: index
      };
      return true;
    }
  });
  return propMatch;
}

ConfigFile.prototype.rename = function(newName) {
  newName = path.resolve(newName);
  if (this.fileName == newName)
    return;
  this.originalName = this.originalName || this.timestamp != -1 && this.fileName;
  this.fileName = newName;
  try {
    this.timestamp = fs.statSync(this.fileName).mtime.getTime();
  }
  catch(e) {
    if (e.code != 'ENOENT')
      throw e;
    this.timestamp = -1;
  }
  this.changed = true;
};

// only applies to values
// Returns undefined for no value
// throws if an object, with a fileName reference
// member lookups not in objects throw
// type is optional, and can be 'array', 'number', 'boolean', 'string' to add simple type checking
ConfigFile.prototype.getValue = function(memberArray, type) {
  var parentProps = this.getProperties(memberArray.slice(0, memberArray.length - 1));

  if (!parentProps)
    return;

  var prop = getProperty(parentProps, memberArray[memberArray.length - 1]).property;

  if (prop === undefined)
    return;

  if (prop.value instanceof Array)
    configError.call(this, memberArray, 'must be a value');

  var value = prop.value.value;

  if (type == 'array' && !(value instanceof Array) || (type && type != 'array' && typeof value != type))
    configError.call(this, memberArray, 'must be a' + (type == 'array' ? 'n ' : ' ') + type + ' value');
  
  return value;
};

function orderingIndex(ordering, key) {
  for (var i = 0; i < ordering.length; i++)
    if (ordering[i] === key || ordering[i] instanceof Array && ordering[i][0] == key)
      return i;
  return -1;
}

function getOrdering(memberArray, ordering) {
  memberArray.some(function(member) {
    var orderIndex = orderingIndex(ordering, member);
    if (orderIndex != -1 && ordering[orderIndex] instanceof Array) {
      ordering = ordering[orderIndex][1];
    }
    else {
      ordering = [];
      return true;
    }
  });
  return ordering;
}

// returns properties array
// If not a properties array, returns undefined
// If any member is a value instead of an object, returns undefined
// When createIfUndefined is set, object is created with the correct ordering
// setting changed: true in the process if necessary
// If any member is a value with createIfUndefined, throws an error
ConfigFile.prototype.getProperties = function(memberArray, createIfUndefined) {
  var properties = this.properties;
  var ordering = this.ordering;
  var self = this;
  memberArray.some(function(member, index) {
    var prop = getProperty(properties, member).property;
    if (prop) {
      properties = prop.value;
      if (!(properties instanceof Array)) {
        if (createIfUndefined) {
          configError.call(self, memberArray.slice(0, index + 1), 'should be an object');
        }
        else {
          properties = undefined;
          return true;
        }
      }
    }
    else {
      if (createIfUndefined) {
        setProperty(properties, member, properties = [], ordering);
        self.onChange(memberArray);
      }
      else {
        properties = undefined;
        return true;
      }
    }
    ordering = getOrdering([member], ordering);
  });
  return properties;
};

// returns properties array as a readable JS object of values.
// Nested objects throw nice error unless nested is set to true
// if the object does not exist, returns undefined
// if the property corresponds to a value, throws
ConfigFile.prototype.getObject = function(memberArray, nested, createIfUndefined) {
  var properties = this.getProperties(memberArray, createIfUndefined);

  if (!properties)
    return;
  
  var obj = propertiesToObject(properties);
  
  var self = this;
  if (!nested)
    Object.keys(obj).forEach(function(key) {
      if (typeof obj[key] == 'object' && obj[key] !== null && !(obj[key] instanceof Array))
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
    if (typeof value == 'object' && !(value instanceof Array) && value !== null)
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
  var parentProps = this.getProperties(memberArray.slice(0, memberArray.length - 1));

  if (!parentProps)
    return false;

  return getProperty(parentProps, memberArray[memberArray.length - 1]).property !== undefined;
};

// removes the given property member name if it exists
ConfigFile.prototype.remove = function(memberArray, clearParentsIfMadeEmpty) {
  var parentProps = this.getProperties(memberArray.slice(0, memberArray.length - 1));

  if (!parentProps)
    return false;

  var self = this;
  var removed = parentProps.some(function(prop, index) {
    if (prop.key == memberArray[memberArray.length - 1]) {
      parentProps.splice(index, 1);
      self.onChange(memberArray.slice(0, memberArray.length - 1));
      return true;
    }
  });

  if (clearParentsIfMadeEmpty && removed && parentProps.length == 0 && memberArray.length > 1)
    this.remove(memberArray.slice(0, memberArray.length - 1), true);

  return removed;
};

ConfigFile.prototype.clearIfEmpty = function(memberArray) {
  var props = this.getProperties(memberArray);
  if (props && !props.length)
    this.remove(memberArray);
};

// sets this.changed if a change
// retains property ordering
// overwrites anything already existing
// creates objects if not existing, at correct ordered location
ConfigFile.prototype.setValue = function(memberArray, value) {
  var properties = this.getProperties(memberArray.slice(0, memberArray.length - 1), true);

  var ordering = getOrdering(memberArray.slice(0, memberArray.length - 1), this.ordering);

  if (setProperty(properties, memberArray[memberArray.length - 1], { value: value }, ordering))
    this.onChange(memberArray);
};

// handles nested objects, memberArray can be 0 length for base-level population
// where target object already exists, it overwrites retaining the same ordering
// default behaviour is to not write empty objects, but to also not clear objects made empty
// also avoids unnecessary changes
ConfigFile.prototype.setProperties = function(memberArray, properties, clearIfEmpty, keepOrder, extend) {
  var targetProperties;

  if (!properties.length) {
    targetProperties = this.getProperties(memberArray);
    if (targetProperties && targetProperties.length) {
      if (clearIfEmpty)
        this.remove(memberArray);
      else
        targetProperties.splice(0, targetProperties.length);
      this.onChange(memberArray);
    }
    else if (!clearIfEmpty)
      this.getProperties(memberArray, true);
    return;
  }

  targetProperties = this.getProperties(memberArray, true);

  var ordering;
  if (!keepOrder)
    ordering = getOrdering(memberArray.slice(0, memberArray.length - 1), this.ordering);

  var self = this;

  var setKeys = [];
  properties.forEach(function(prop) {
    setKeys.push(prop.key);
    if (setProperty(targetProperties, prop.key, prop.value, ordering))
      self.onChange(memberArray);
  });

  if (extend !== true)
    for (var i = 0; i < targetProperties.length; i++) {
      var prop = targetProperties[i];
      if (setKeys.indexOf(prop.key) == -1) {
        targetProperties.splice(i--, 1);
        self.onChange(memberArray);
      }
    }
};

// ensures the given property is first in its containing object property
// skips if the property does not exist
ConfigFile.prototype.orderFirst = function(memberArray) {
  var properties = this.getProperties(memberArray.slice(0, memberArray.length - 1));

  if (!properties)
    return;
  
  var propIndex = getProperty(properties, memberArray[memberArray.length - 1]).index;

  if (propIndex != -1 && propIndex != 0) {
    properties.unshift(properties.splice(propIndex, 1)[0]);
    this.onChange(memberArray.slice(0, memberArray.length - 1));
  }
};

// ensures the given property is last in its containing object property
// skips if the property does not exist
ConfigFile.prototype.orderLast = function(memberArray) {
  var properties = this.getProperties(memberArray.slice(0, memberArray.length - 1));

  if (!properties)
    return;
  
  var propIndex = getProperty(properties, memberArray[memberArray.length - 1]).index;

  if (propIndex != -1 && propIndex != properties.length - 1) {
    properties.push(properties.splice(propIndex, 1)[0]);
    this.onChange(memberArray.slice(0, memberArray.length - 1));
  }
};

// only clears on empty if not already existing as empty
// sets this.changed, retains ordering and overwrites as with setValue
// keepOrder indicates if new properties should be added in current iteration order 
// instead of applying the ordering algorithm
ConfigFile.prototype.setObject = function(memberArray, obj, clearIfEmpty, keepOrder) {
  // convert object into a properties array
  return this.setProperties(memberArray, objectToProperties(obj), clearIfEmpty, keepOrder, false);
};
ConfigFile.prototype.extendObject = function(memberArray, obj, keepOrder) {
  return this.setProperties(memberArray, objectToProperties(obj), false, keepOrder, true);
};

// default serialization is as a JSON file, but these can be overridden
ConfigFile.prototype.serialize = function(obj) {
  var jsonString = JSON.stringify(obj, null, this.style.tab);

  if (this.style.trailingNewline)
    jsonString += this.style.newline;

  return jsonString
      .replace(/([^\\])""/g, '$1' + this.style.quote + this.style.quote) // empty strings
      .replace(/([^\\])"/g, '$1' + this.style.quote)
      .replace(/\n/g, this.style.newline);
};
ConfigFile.prototype.deserialize = function(source) {
  return JSON.parse(source);
};

// note that the given proprety is changed
// also triggers change events
ConfigFile.prototype.onChange = function(memberArray) {
  // run any attached change events
  if (!this.changeEvents.reduce(function(stopPropagation, evt) {
    return stopPropagation || evt(memberArray);
  }, false))
    this.changed = true;
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

  var deserializedObj;

  try {
    deserializedObj = this.deserialize(contents || '{}') || {};
  }
  catch(e) {
    configError.call(this, e.toString());
  }

  this.setObject([], deserializedObj, false, true);
  this.changed = false;
};
ConfigFile.prototype.write = function() {
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
    throw new Error('Configuration file ' + path.relative(process.cwd(), this.fileName) + ' has been modified by another process.');

  if (this.changed || timestamp == -1) {
    // if the file doesn't exist make sure the folder exists
    mkdirp.sync(path.dirname(this.fileName));
    var obj = this.getObject([], true);
    fs.writeFileSync(this.fileName, this.serialize(obj));
    this.timestamp = fs.statSync(this.fileName).mtime.getTime();

    this.changed = false;

    // if the file was renamed, remove the old file now after writing
    if (this.originalName) {
      fs.unlinkSync(this.originalName);
      this.originalName = null;
    }
  }
};

function detectStyle(string) {
  var style = {
    tab: '  ',
    newline: require('os').EOL,
    trailingNewline: true,
    quote: '"'
  };

  var newLineMatch = string.match( /\r?\n|\r(?!\n)/);
  if (newLineMatch)
    style.newline = newLineMatch[0];

  // best-effort tab detection
  // yes this is overkill, but it avoids possibly annoying edge cases
  var tabSpaces = string.split(style.newline).map(function(line) { return line.match(/^[ \t]*/)[0]; }) || [];
  var tabDifferenceFreqs = {};
  var lastLength = 0;
  tabSpaces.forEach(function(tabSpace) {
    var diff = Math.abs(tabSpace.length - lastLength);
    if (diff != 0)
      tabDifferenceFreqs[diff] = (tabDifferenceFreqs[diff] || 0) + 1;
    lastLength = tabSpace.length;
  });
  var bestTabLength;
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
  });
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

  if (string && !string.match(new RegExp(style.newline + '$')))
    style.trailingNewline = false;

  return style;
}