/*
 *   Copyright 2014-2018 Guy Bedford (http://guybedford.com)
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
import fs = require('fs');
import path = require('path');

export async function writeBinScripts (binDir: string, name: string, binModulePath: string) {
  await [new Promise((resolve, reject) => 
    fs.writeFile(path.resolve(binDir, name), unixBin(binModulePath), {
      mode: 0o777
    }, err => err ? reject(err) : resolve())
  ), new Promise((resolve, reject) =>
    fs.writeFile(path.resolve(binDir, name + '.cmd'), winBin(binModulePath), {
      mode: 0o777
    }, err => err ? reject(err) : resolve())
  )];
}

const unixBin = (binModulePath: string) => `#!/bin/sh
BASE_DIR=$(dirname $(dirname $(realpath $0)))
if [ -d $BASE_DIR/npm/@jspm/resolve* ]; then
  JSPM_LOADER=$(realpath $BASE_DIR/npm/@jspm/resolve*/loader.mjs)
else
  JSPM_PATH=$(which jspm 2>/dev/null)
  if [ "$?" != "0" ] || [ -z "$JSPM_PATH" ]; then
    echo "jspm not found, make sure it is installed."
    exit 1
  fi
  JSPM_DIR=$(dirname $(dirname $(realpath "$JSPM_PATH")))
  if [ -d $JSPM_DIR/node_modules ]; then
    JSPM_LOADER=$JSPM_DIR/node_modules/@jspm/resolve/loader.mjs
  elif [ -d $JSPM_DIR/jspm_packages ]; then
    JSPM_LOADER=$JSPM_DIR/jspm_packages/npm/@jspm/resolve*/loader.mjs
  else
    echo "jspm loader not found, make sure it is installed."
    exit 1
  fi
fi
case "$(uname -s)" in
  CYGWIN*|MINGW32*|MINGW64*)
    JSPM_LOADER=/$(cygpath -w "$JSPM_LOADER")
    BASE_DIR=/$(cygpath -w "$BASE_DIR")
    ;;
  *)
    JSPM_LOADER=$(dirname "$JSPM_LOADER")
    ;;
esac
NODE_OPTIONS="--experimental-modules --loader $JSPM_LOADER" node "$BASE_DIR/${binModulePath}" "$@"
ret=$?
exit $ret
`;

const winBin = (binModulePath: string) => `@setlocal
@for %%X in (jspm) do @(set JSPM_PATH=%%~dp$PATH:X)
@if "%JSPM_PATH%"=="" (
  @echo jspm not found in path, make sure it is installed globally.
  @exit /B 1
)
@NODE_OPTIONS="--experimental-modules --no-warnings --loader \"/%JSPM_PATH%node_modules\\jspm\\node_modules\\jspm-resolve\\loader.mjs\"" node "%~dp0\\..\\${binModulePath}" %*
`;
