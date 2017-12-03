import { warn, ok } from '../utils/ui';
import { bold } from '../utils/common';
import path = require('path');
import fs = require('graceful-fs');

export async function checkPjsonEsm (projectPath: string) {
  // for the given project path, find the first package.json and ensure it has "esm": true
  // if it does not, then warn, and correct
  let hasEsm = false;
  let pjsonPath = projectPath;
  if (!pjsonPath.endsWith(path.sep))
    pjsonPath += path.sep;
  do {
    try {
      var source = fs.readFileSync(pjsonPath + 'package.json').toString();
    }
    catch (err) {
      if (!err || err.code !== 'ENOENT')
        throw err;
    }
    if (source) {
      try {
        var pjson = JSON.parse(source);
      }
      catch (err) {
        return;
      }
      if (typeof pjson.esm === 'boolean')
        hasEsm = true;
      break;
    }
    pjsonPath = pjsonPath.substr(0, pjsonPath.lastIndexOf(path.sep, pjsonPath.length - 2) + 1);
  }
  while (pjsonPath && source === undefined)

  if (hasEsm === false) {
    warn(`The current path is not configured to load JavaScript modules (ES Modules) from ".js" extensions, as the package.json file does not contain an ${bold(`"esm": true`)} property.
${bold(`Press <Return>`)} to add this property to your package.json file automatically.`);
    function checkFixup (buf) {
      if (buf.readInt8() === 13) {
        const pjson = JSON.parse(fs.readFileSync(pjsonPath + 'package.json').toString());
        pjson.esm = true;
        fs.writeFileSync(pjsonPath + 'package.json', JSON.stringify(pjson, null, 2));
        ok(`${bold(`"esm": true`)} property added to ${projectPath}${path.sep}package.json succesfully.`);
        process.stdin.removeListener('data', checkFixup);
      }
    }
    process.stdin.on('data', checkFixup);
  }
}