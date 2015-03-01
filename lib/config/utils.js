// convert structured configuration into a plain object
// by calling the .write() methods of structured classes
// properties ending in _ are considered private
// NB may be less convoluted just to make these explicit
module.exports.extractObj = function extractObj(obj, host) {
  var out = {};
  for (var p in obj) {
    if (!obj.hasOwnProperty(p))
      continue;
    if (p.substr(0, 2) ==  '__')
      continue;

    var val = obj[p];
    if (typeof val == 'string')
      out[p] = val;
    else if (typeof val == 'object') {
      if (typeof val.write == 'function')
        out[p] = val.write();
      else if (val instanceof Array)
        out[p] = val;
      else
        out[p] = extractObj(val, {});
    }
  }
  for (var p in host)
    if (!(p in out))
      out[p] = host[p];
  return out;
};
