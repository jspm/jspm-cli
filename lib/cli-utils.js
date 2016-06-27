exports.readOptions = readOptions;
exports.readValue = readValue;
exports.readPropertySetters = readPropertySetters;

// takes commandline args, space-separated
// flags is array of flag names
// optFlags is array of flags that have option values
// optFlags suck up arguments until next flag
// returns { [flag]: true / false, ..., [optFlag]: value, ..., args: [all non-flag args] }
function readOptions(inArgs, flags, optFlags) {
  // output options object
  var options = { args: [] };

  flags = flags || [];
  optFlags = optFlags || [];

  var curOptionFlag;

  function getFlagMatch(arg, flags) {
    var index;

    if (arg.startsWith('--')) {
      index = flags.indexOf(arg.substr(2));
      if (index !== -1)
        return flags[index];
    }
    else if (arg.startsWith('-')) {
      return flags.filter(function(f) {
        return f.substr(0, 1) === arg.substr(1, 1);
      })[0];
    }
  }

  // de-sugar any coupled single-letter flags
  // -abc -> -a -b -c
  var args = [];
  inArgs.forEach(function(arg) {
    if (arg[0] == '-' && arg.length > 1 && arg[1] != '-') {
      for (var i = 1; i < arg.length; i++)
        args.push('-' + arg[i]);
    }
    else {
      args.push(arg);
    }
  });

  args.forEach(function(arg) {
    var flag = getFlagMatch(arg, flags);
    var optFlag = getFlagMatch(arg, optFlags);

    // option flag -> suck up args
    if (optFlag) {
      curOptionFlag = optFlag;
      options[curOptionFlag] = [];
    }
    // normal boolean flag
    else if (flag) {
      options[flag] = true;
    }
    // value argument
    else {
      if (curOptionFlag)
        options[curOptionFlag].push(arg);
      else
        options.args.push(arg);
    }
  });

  // flag values are strings
  optFlags.forEach(function(flag) {
    if (options[flag])
      options[flag] = options[flag].join(' ');
  });

  return options;
}

// this will get a value in its true type from the CLI
function readValue(val) {
  val = val.trim();
  if (val === 'true' || val === 'false')
    return eval(val);
  else if (parseInt(val).toString() == val)
    return parseInt(val);
  else if (val[0] == '{' && val[val.length - 1] == '}')
    return eval('(' + val + ')');
  else if (val[0] == '[' && val[val.length - 1] == ']')
    if (val.indexOf('\'') == -1 && val.indexOf('\"') == -1)
      return val.substr(1, val.length - 2).split(',').map(function(item) {
        return item.trim();
      });
    else
      return eval('(' + val + ')');
  else
    return val;
}

function readPropertySetters(str, dottedProperties) {
  var outObj = {};

  function setProperty(target, p, value) {
    var pParts = p.split('.');
    var curPart;
    while (pParts.length) {
      if (curPart !== undefined)
        target = target[curPart] = target[curPart] || {};
      curPart = pParts.shift();

      // allow properties to be indicated by square brackets as well (a.b['c'].d)
      if (curPart.indexOf('[') != -1) {
        var lastPart = curPart.substr(curPart.indexOf('[') + 1);
        lastPart = lastPart + (lastPart ? '.' : '') + pParts.join('.');
        if (lastPart.indexOf(']') == -1 || lastPart.indexOf(']') == 0)
          continue;

        var bracketPart = lastPart.substr(0, lastPart.indexOf(']'));
        if (bracketPart[0] == '"' && bracketPart[bracketPart.length - 1] == '"' || bracketPart[0] == '\'' && bracketPart[bracketPart.length - 1] == '\'')
          bracketPart = bracketPart.substr(1, bracketPart.length - 2);

        curPart = curPart.substr(0, curPart.indexOf('['));

        lastPart = lastPart.substr(lastPart.indexOf(']') + 1);
        if (lastPart[0] == '.')
          lastPart = lastPart.substr(1);
        pParts = [bracketPart].concat(lastPart ? lastPart.split('.') : []);
      }
    }
    setValue(target, curPart, value);
  }
  function setValue(target, p, value) {
    if (p.substr(p.length - 2, 2) == '[]')
      target[p.substr(0, p.length - 2)] = value.split(',');
    else
      target[p] = value;
  }

  var parts = str.split('=');
  var lastProp;
  parts.forEach(function(part, index) {
    if (!lastProp) {
      lastProp = part;
      return;
    }

    var value = readValue(index == parts.length - 1 ? part : part.substr(0, part.lastIndexOf(' ')));
    lastProp = lastProp.trim();
    if (dottedProperties)
      setProperty(outObj, lastProp, value);
    else
      setValue(outObj, lastProp, value);
    lastProp = part.substr(part.lastIndexOf(' ') + 1).trim();
  });

  return outObj;
}