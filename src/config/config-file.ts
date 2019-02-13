/*
 *   Copyright 2014-2019 Guy Bedford (http://guybedford.com)
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

import path = require('path');
import fs = require('graceful-fs');
import mkdirp = require('mkdirp');
import lockfile = require('proper-lockfile');
import { JspmError, JspmUserError, bold } from '../utils/common';

export type OrderingValue = string | [string, OrderingArray];
export interface OrderingArray extends Array<OrderingValue> {}

export interface ConfigValue {
  value: any[] | number | boolean | string
}
export interface ObjectProperty {
  key: string,
  value: ConfigObject | ConfigValue
}
export type ConfigObject = ObjectProperty[];
export type ValueType = 'array' | 'number' | 'boolean' | 'string';

interface sourceStyle {
  trailingNewline: boolean,
  newline: string,
  quote: string,
  tab: string
}

/*
 * Configuration base class
 * For creating and managing configurations which sync to files
 */
export default class ConfigFile {
  fileName: string;
  private ordering: OrderingArray;
  private style: sourceStyle = null;
  protected timestamp: number = null;
  /*
   * Properties are stored as an ordered array of { key, value } paris
   * Nested object are in turn array values
   * Value properties are { value } objects
   */
  private properties: ConfigObject = [];
  protected changeEvents: ((configMember: string[]) => void | boolean)[] = [];
  
  // we only write when the file has actually changed
  protected changed: boolean = false;
  // keep track of originalName when renaming
  private originalName: string = undefined;

  private _unlock: () => void;
  
  protected locked = false;

  constructor (fileName: string, ordering: OrderingArray) {
    this.fileName = path.resolve(fileName);

    this.ordering = ordering;
  }

  rename (newName: string) {
    newName = path.resolve(newName);
    if (this.fileName === newName)
      return;
    this.originalName = this.originalName || this.timestamp !== -1 && this.fileName;
    this.fileName = newName;
    try {
      this.timestamp = fs.statSync(this.fileName).mtime.getTime();
    }
    catch (e) {
      if (e.code !== 'ENOENT')
        throw e;
      this.timestamp = -1;
    }
    this.changed = true;
  }

  // only applies to values
  // Returns undefined for no value
  // throws if an object, with a fileName reference
  // member lookups not in objects throw
  // type is optional, and can be 'array', 'number', 'boolean', 'string' to add simple type checking
  protected getValue (memberArray: string[], type?: ValueType) {
    var parentProps = this.getProperties(memberArray.slice(0, memberArray.length - 1));

    if (!parentProps)
      return;

    var prop = getProperty(parentProps, memberArray[memberArray.length - 1]).property;

    if (prop === undefined)
      return;

    if (Array.isArray(prop.value))
      configError.call(this, memberArray, 'must be a value');

    var value = prop.value.value;

    if (type === 'array' && !Array.isArray(value) || (type && type !== 'array' && typeof value !== type))
      configError.call(this, memberArray, 'must be a' + (type === 'array' ? 'n ' : ' ') + type + ' value');

    return value;
  }

  // returns properties array
  // If not a properties array, returns undefined
  // If any member is a value instead of an object, returns undefined
  // When createIfUndefined is set, object is created with the correct ordering
  // setting changed: true in the process if necessary
  // If any member is a value with createIfUndefined, throws an error
  protected getProperties (memberArray: string[], createIfUndefined = false) {
    var properties = this.properties;
    var ordering = this.ordering;
    var self = this;
    memberArray.some((member, index) => {
      var prop = getProperty(properties, member).property;
      if (prop) {
        properties = prop.value;
        if (!Array.isArray(properties)) {
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
  }

  // returns properties array as a readable JS object of values.
  // Nested objects throw nice error unless nested is set to true
  // if the object does not exist, returns undefined
  // if the property corresponds to a value, throws
  protected getObject (memberArray = [], nested = true, createIfUndefined = false) {
    var properties = this.getProperties(memberArray, createIfUndefined);

    if (!properties)
      return;

    var obj = propertiesToObject(properties);

    var self = this;
    if (!nested)
      Object.keys(obj).forEach(key => {
        if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key]))
          configError.call(self, memberArray, 'should not contain a nested object at %' + key + '%');
      });

    return obj;
  }

  protected has (memberArray: string[]) {
    var parentProps = this.getProperties(memberArray.slice(0, memberArray.length - 1));

    if (!parentProps)
      return false;

    return getProperty(parentProps, memberArray[memberArray.length - 1]).property !== undefined;
  }

  // removes the given property member name if it exists
  protected remove (memberArray: string[], clearParentsIfMadeEmpty = false) {
    var parentProps = this.getProperties(memberArray.slice(0, memberArray.length - 1));

    if (!parentProps)
      return false;

    var self = this;
    var removed = parentProps.some((prop, index) => {
      if (prop.key === memberArray[memberArray.length - 1]) {
        parentProps.splice(index, 1);
        self.onChange(memberArray.slice(0, memberArray.length - 1));
        return true;
      }
    });

    if (clearParentsIfMadeEmpty && removed && parentProps.length === 0 && memberArray.length > 1)
      this.remove(memberArray.slice(0, memberArray.length - 1), true);

    return removed;
  }

  protected clearIfEmpty (memberArray: string[]) {
    var props = this.getProperties(memberArray);
    if (props && !props.length)
      this.remove(memberArray);
  }

  // sets this.changed if a change
  // retains property ordering
  // overwrites anything already existing
  // creates objects if not existing, at correct ordered location
  protected setValue (memberArray: string[], value, overwrite = true) {
    var properties = this.getProperties(memberArray.slice(0, memberArray.length - 1), true);

    var ordering = getOrdering(memberArray.slice(0, memberArray.length - 1), this.ordering);

    if (setProperty(properties, memberArray[memberArray.length - 1], { value: value }, ordering, overwrite))
      this.onChange(memberArray);
  }

  // handles nested objects, memberArray can be 0 length for base-level population
  // where target object already exists, it overwrites retaining the same ordering
  // default behaviour is to not write empty objects, but to also not clear objects made empty
  // also avoids unnecessary changes
  protected setProperties (memberArray: string[], properties: ConfigObject, clearIfEmpty = false, keepOrder = false, extend = true, overwrite = false) {
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
    properties.forEach(prop => {
      setKeys.push(prop.key);
      if (setProperty(targetProperties, prop.key, prop.value, ordering, overwrite))
        self.onChange(memberArray);
    });

    if (!extend)
      for (var i = 0; i < targetProperties.length; i++) {
        var prop = targetProperties[i];
        if (setKeys.indexOf(prop.key) === -1) {
          targetProperties.splice(i--, 1);
          self.onChange(memberArray);
        }
      }
  }

  // ensures the given property is first in its containing object property
  // skips if the property does not exist
  protected orderFirst (memberArray: string[]) {
    var properties = this.getProperties(memberArray.slice(0, memberArray.length - 1));

    if (!properties)
      return;

    var propIndex = getProperty(properties, memberArray[memberArray.length - 1]).index;

    if (propIndex !== -1 && propIndex !== 0) {
      properties.unshift(properties.splice(propIndex, 1)[0]);
      this.onChange(memberArray.slice(0, memberArray.length - 1));
    }
  }

  // ensures the given property is last in its containing object property
  // skips if the property does not exist
  protected orderLast (memberArray: string[]) {
    var properties = this.getProperties(memberArray.slice(0, memberArray.length - 1));

    if (!properties)
      return;

    var propIndex = getProperty(properties, memberArray[memberArray.length - 1]).index;

    if (propIndex !== -1 && propIndex !== properties.length - 1) {
      properties.push(properties.splice(propIndex, 1)[0]);
      this.onChange(memberArray.slice(0, memberArray.length - 1));
    }
  }

  // only clears on empty if not already existing as empty
  // sets this.changed, retains ordering and overwrites as with setValue
  // keepOrder indicates if new properties should be added in current iteration order
  // instead of applying the ordering algorithm
  protected setObject (memberArray: string[] = [], obj, clearIfEmpty = false, keepOrder = false) {
    // convert object into a properties array
    return this.setProperties(memberArray, objectToProperties(obj), clearIfEmpty, keepOrder, false);
  }

  protected extendObject (memberArray: string[] | any, obj?, keepOrder = false) {
    if (!Array.isArray(memberArray)) {
      obj = memberArray;
      memberArray = [];
    }
    return this.setProperties(memberArray, objectToProperties(obj), false, keepOrder, true);
  }

  protected prependObject (memberArray: string[] | any, obj?, keepOrder = false) {
    if (!Array.isArray(memberArray)) {
      obj = memberArray;
      memberArray = [];
    }
    return this.setProperties(memberArray, objectToProperties(obj), false, keepOrder, true, false);
  }

  // default serialization is as a JSON file, but these can be overridden
  protected serialize (obj) {
    return serializeJson(obj, this.style);
  }

  protected deserialize (source: string) {
    return JSON.parse(source);
  }

  // note that the given proprety is changed
  // also triggers change events
  onChange (memberArray: string[]) {
    // run any attached change events
    if (!this.changeEvents.reduce((stopPropagation, evt) => stopPropagation || evt(memberArray), false))
      this.changed = true;
  }

  protected lock (symlink = true) {
    try {
      this._unlock = lockfile.lockSync(this.fileName, symlink ? undefined : { realpath: false });
      this.locked = true;
    }
    catch (e) {
      if (symlink && e.code === 'ENOENT')
        return this.lock(false);
      if (e.code === 'ELOCKED')
        throw new JspmUserError(`Configuration file ${bold(this.fileName)} is currently locked by another jspm process.`);
      throw e;
    }
  }

  protected unlock () {
    if (this._unlock) {
      this._unlock();
      this._unlock = undefined;
      this.locked = false;
    }
  }

  exists (): boolean {
    if (this.timestamp === null)
      this.read();
    return this.timestamp === -1 ? false : true;
  }

  // read and write are sync functions
  protected read () {
    var contents;
    try {
      this.timestamp = fs.statSync(this.fileName).mtime.getTime();
      contents = fs.readFileSync(this.fileName).toString();
    }
    catch (e) {
      if (e.code !== 'ENOENT')
        throw e;

      this.timestamp = -1;
      contents = '';
    }

    this.style = detectStyle(contents);

    var deserializedObj;

    try {
      deserializedObj = this.deserialize(contents || '{}') || {};
    }
    catch (e) {
      configError.call(this, e.toString());
    }

    this.properties = [];
    this.setObject([], deserializedObj, false, true);
    this.changed = false;
  }

  protected write () {
    var timestamp;
    try {
      timestamp = fs.statSync(this.fileName).mtime.getTime();
    }
    catch (e) {
      if (e.code !== 'ENOENT')
        throw e;

      timestamp = -1;
    }

    if (timestamp !== this.timestamp)
      throw new JspmUserError('Configuration file ' + path.relative(process.cwd(), this.fileName) + ' has been modified by another process.');

    if (this.changed || timestamp === -1) {
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
      return true;
    }
    return false;
  }
};

function configError (memberArray, msg) {
  if (arguments.length === 1) {
    msg = memberArray;
    memberArray = [];
  }
  throw new JspmUserError(`Error reading ${bold(path.relative(process.cwd(), this.fileName))}\n\t` +
      (memberArray.length ? bold(memberArray.join('.')) + ' ' : 'File ') + msg + '.');
}

function propertyEquals (propA, propB) {
  if (Array.isArray(propA) || Array.isArray(propB)) {
    if (!(Array.isArray(propA) && Array.isArray(propB)))
      return false;

    if (propA.length !== propB.length)
      return false;

    return !propA.some((itemA, index) => {
      var itemB = propB[index];
      return itemA.key !== itemB.key || !propertyEquals(itemA.value, itemB.value);
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
function setProperty (properties: ConfigObject, key: string, value, ordering: OrderingArray, overwrite = true) {
  var changed = false;
  if (properties.some(prop => {
    if (prop.key === key) {
      if (!overwrite)
        return false;
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
  if (orderIndex !== -1)
    properties.forEach((prop, index) => {
      // get the ordering index of the current property
      var propOrderIndex = orderingIndex(ordering, prop.key);
      if (propOrderIndex !== -1) {
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

  if (orderIndex === -1)
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
function getProperty (properties, key) {
  var propMatch = {
    index: -1,
    property: undefined
  };
  properties.some((prop, index) => {
    if (prop.key === key) {
      propMatch = {
        property: prop,
        index: index
      };
      return true;
    }
  });
  return propMatch;
}

function orderingIndex (ordering: OrderingArray, key: string) {
  for (var i = 0; i < ordering.length; i++)
    if (ordering[i] === key || Array.isArray(ordering[i]) && ordering[i][0] === key)
      return i;
  return -1;
}

function getOrdering (memberArray: string[], ordering: OrderingArray): OrderingArray {
  memberArray.some(member => {
    let orderIndex = orderingIndex(ordering, member);
    let orderingValue;
    if (orderIndex !== -1)
      orderingValue = ordering[orderIndex];
    if (Array.isArray(orderingValue)) {
      ordering = orderingValue[1];
    }
    else {
      ordering = [];
      return true;
    }
  });
  return ordering;
}

function propertiesToObject (properties: ConfigObject) {
  var obj = {};
  properties.forEach(p => {
    var prop = p.key;
    var val = p.value;

    if (Array.isArray(val))
      obj[prop] = propertiesToObject(val);
    else
      obj[prop] = val.value;
  });
  return obj;
}

function objectToProperties (obj): ConfigObject {
  var properties = [];
  Object.keys(obj).forEach(key => {
    var value = obj[key];
    if (typeof value === 'object' && !Array.isArray(value) && value !== null)
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

export interface jsonStyle {
  tab: string,
  newline: string,
  trailingNewline: boolean,
  quote: string
};

export async function readJSONStyled (filePath: string): Promise<{ json: any, style: jsonStyle }> {
  try {
    var source = await new Promise<string>((resolve, reject) => {
      fs.readFile(filePath, (err, source) => err ? reject(err) : resolve(source.toString()));
    });
  }
  catch (e) {
    if (e.code === 'ENOENT')
      return { json, style };
    throw e;
  }
  // remove any byte order mark
  if (source.startsWith('\uFEFF'))
    source = source.substr(1);
  
  var style = detectStyle(source);
  try {
    var json = JSON.parse(source);
  }
  catch (e) {
    throw new JspmError(`Error parsing JSON file ${filePath}.`);
  }

  return { json, style };
}

export async function writeJSONStyled (filePath: string, json: any, style: jsonStyle) {
  await new Promise((resolve, reject) => fs.writeFile(filePath, serializeJson(json, style), err => err ? reject(err) : resolve()));
}

export const defaultStyle = {
  tab: '  ',
  newline: require('os').EOL,
  trailingNewline: true,
  quote: '"'  
};

export function detectStyle (string: string): jsonStyle {
  let style = Object.assign({}, defaultStyle);

  let newLineMatch = string.match( /\r?\n|\r(?!\n)/);
  if (newLineMatch)
    style.newline = newLineMatch[0];

  // best-effort tab detection
  // yes this is overkill, but it avoids possibly annoying edge cases
  let tabSpaces = string.split(style.newline).map(line => line.match(/^[ \t]*/)[0]) || [];
  let tabDifferenceFreqs = {};
  let lastLength = 0;
  tabSpaces.forEach(tabSpace => {
    let diff = Math.abs(tabSpace.length - lastLength);
    if (diff !== 0)
      tabDifferenceFreqs[diff] = (tabDifferenceFreqs[diff] || 0) + 1;
    lastLength = tabSpace.length;
  });
  let bestTabLength;
  Object.keys(tabDifferenceFreqs).forEach(tabLength => {
    if (!bestTabLength || tabDifferenceFreqs[tabLength] >= tabDifferenceFreqs[bestTabLength])
      bestTabLength = tabLength;
  });
  // having determined the most common spacing difference length,
  // generate samples of this tab length from the end of each line space
  // the most common sample is then the tab string
  let tabSamples = {};
  tabSpaces.forEach(tabSpace => {
    let sample = tabSpace.substr(tabSpace.length - bestTabLength);
    tabSamples[sample] = (tabSamples[sample] || 0) + 1;
  });
  let bestTabSample;
  Object.keys(tabSamples).forEach(sample => {
    if (!bestTabSample || tabSamples[sample] > tabSamples[bestTabSample])
      bestTabSample = sample;
  });

  if (bestTabSample)
    style.tab = bestTabSample;

  let quoteMatch = string.match(/"|'/);
  if (quoteMatch)
    style.quote = quoteMatch[0];

  if (string && !string.match(new RegExp(style.newline + '$')))
    style.trailingNewline = false;

  return style;
}

export function serializeJson (json, style: jsonStyle) {
  let jsonString = JSON.stringify(json, null, style.tab);

  if (style.trailingNewline)
    jsonString += style.newline;

  return jsonString
      .replace(/([^\\])""/g, '$1' + style.quote + style.quote) // empty strings
      .replace(/([^\\])"/g, '$1' + style.quote)
      .replace(/\n/g, style.newline);
}