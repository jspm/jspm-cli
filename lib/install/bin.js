"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const path = require("path");
async function writeBinScripts(binDir, name, binModulePath) {
    await [new Promise((resolve, reject) => fs.writeFile(path.resolve(binDir, name), unixBin(binModulePath), {
            mode: 0o777
        }, err => err ? reject(err) : resolve())), new Promise((resolve, reject) => fs.writeFile(path.resolve(binDir, name + '.cmd'), winBin(binModulePath), {
            mode: 0o777
        }, err => err ? reject(err) : resolve()))];
}
exports.writeBinScripts = writeBinScripts;
const unixBin = (binModulePath) => `#!/bin/sh
JSPM_PATH=$(which jspm 2>/dev/null)
if [ "$?" != "0" ] || [ -z "$JSPM_PATH" ]; then
  echo "jspm not found in path, make sure it is installed globally."
  exit 1
fi
JSPM_DIR=$(dirname $(realpath "$JSPM_PATH"))
BASE_DIR=$(dirname $(dirname $0))
case "$(uname -s)" in
  CYGWIN*|MINGW32*|MINGW64*)
    JSPM_DIR=/$(cygpath -w "$JSPM_DIR")
    BASE_DIR=$(cygpath -w "$BASE_DIR")
    ;;
  *)
    JSPM_DIR=$(dirname "$JSPM_DIR")
    ;;
esac
NODE_OPTIONS="--experimental-modules --loader \"//$JSPM_DIR/node_modules/jspm-resolve/loader.mjs\"" node "$BASE_DIR/${binModulePath}" "$@"
ret=$?
exit $ret`;
const winBin = (binModulePath) => `@setlocal
@for %%X in (jspm) do @(set JSPM_PATH=%%~dp$PATH:X)
@if "%JSPM_PATH%"=="" (
  @echo jspm not found in path, make sure it is installed globally.
  @exit /B 1
)
@NODE_OPTIONS="--experimental-modules --loader \"/%JSPM_PATH%node_modules\\jspm\\node_modules\\jspm-resolve\\loader.mjs\"" node "%~dp0\\..\\${binModulePath}" %*`;
//# sourceMappingURL=bin.js.map