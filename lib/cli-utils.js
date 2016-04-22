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
  else
    return val;
}

function readPropertySetters(str, dottedProperties) {
  var outObj = {};

  function setProperty(target, p, value) {
    var pParts = p.split('.');
    var curPart;
    while (pParts.length > 1) {
      curPart = pParts.shift();
      target = target[curPart] = target[curPart] || {};
    }
    curPart = pParts.shift();
    if (!(curPart in target))
      target[curPart] = value;
  }

  var parts = str.split('=');
  var lastProp;
  parts.forEach(function(part, index) {
    if (!lastProp) {
      lastProp = part;
      return;
    }

    var value = readValue(index == parts.length - 1 ? part : part.substr(0, part.lastIndexOf(' ')));
    if (dottedProperties)
      setProperty(outObj, lastProp, value);
    else
      outObj[lastProp] = value;
    lastProp = part.substr(part.lastIndexOf(' ') + 1).trim();
  });

  return outObj;
}