// convert structured configuration into a plain object
// by calling the .write() methods of structured classes
// properties ending in _ are considered private
// NB may be less convoluted just to make these explicit
require('core-js/es6/string');

module.exports.extractObj = function extractObj(obj, host) {
  var out = {};
  for (var p in obj) {
    if (!obj.hasOwnProperty(p))
      continue;
    if (p.startsWith('__'))
      continue;

    var val = obj[p];
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean')
      out[p] = val;
    else if (typeof val === 'object') {
      if (typeof val.write === 'function')
        out[p] = val.write();
      else if (val instanceof Array)
        out[p] = val;
      else
        out[p] = extractObj(val, {});
    }
  }

  for (var h in host)
    if (host.hasOwnProperty(h) && !(h in out))
      out[h] = host[h];

  return out;
};
