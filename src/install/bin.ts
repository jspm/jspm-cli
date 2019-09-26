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
import fs = require('fs');
import path = require('path');
import { isWindows, isCygwin } from '../utils/common';

export async function writeBinScripts (binDir: string, name: string, binModulePath: string, global: boolean) {
  await [new Promise((resolve, reject) => 
    fs.writeFile(path.resolve(binDir, name), global ? globalUnixBin(binModulePath) : localUnixBin(binModulePath), {
      mode: 0o777
    }, err => err ? reject(err) : resolve())
  ), new Promise((resolve, reject) =>
    fs.writeFile(path.resolve(binDir, name + '.cmd'), global ? globalWinBin(binModulePath) : localWinBin(binModulePath), {
      mode: 0o777
    }, err => err ? reject(err) : resolve())
  )];
}

const localUnixBin = (binModulePath: string) => `#!/bin/sh
PACKAGE_SCOPE="$PWD"
while [  ! -f "$PACKAGE_SCOPE/package.json" ]; do
  NEXT_PACKAGE_SCOPE="$(dirname "$PACKAGE_SCOPE")"
  if [ "$NEXT_PACKAGE_SCOPE" == "$PACKAGE_SCOPE" ]; then
    $PACKAGE_SCOPE=""
    break
  fi
  PACKAGE_SCOPE="$NEXT_PACKAGE_SCOPE"
done

if [ ! -z $PACKAGE_SCOPE ] && [ -f "$PACKAGE_SCOPE/jspm_packages/.bin/jspm" ]; then
  JSPM_LOADER=("$PACKAGE_SCOPE"/jspm_packages/npm/@jspm/resolve@*/loader.mjs)
fi
if [ -z $JSPM_LOADER ] || [ ! -f "$JSPM_LOADER" ]; then
  JSPM_DIR="$(dirname $(which jspm 2>/dev/null || echo "."))"
  if [ ! -z $JSPM_DIR ]; then
    JSPM_LOADER=("$(dirname $JSPM_DIR)"/npm/@jspm/resolve@*/loader.mjs)
    if [ ! -f "$JSPM_LOADER" ]; then
      JSPM_LOADER="$JSPM_DIR/node_modules/jspm/node_modules/@jspm/resolve/loader.mjs"
      if [ ! -f "$JSPM_LOADER" ]; then
        JSPM_LOADER="$JSPM_DIR/node_modules/@jspm/resolve/loader.mjs"
        if [ ! -f "$JSPM_LOADER" ]; then
          JSPM_LOADER=""
        fi
      fi
    fi
  fi
fi
if [ -z "$JSPM_LOADER" ]; then
  echo "jspm resolver not found."
  exit 1
fi

BASE_DIR="$(dirname $(dirname $0))"
case "$(uname -s)" in
  CYGWIN*|MINGW32*|MINGW64*)
    JSPM_LOADER="file:///$(cygpath -w "$JSPM_LOADER")"
    BASE_DIR="$(cygpath -aw "$BASE_DIR")"
    ;;
  *)
esac
JSPM_BIN=local NODE_OPTIONS="--experimental-modules --no-warnings --loader $JSPM_LOADER" node "$BASE_DIR/${binModulePath.replace(/\\/g, '/')}" "$@"
ret=$?
exit $ret
`;

const globalUnixBin = (binModulePath: string) => `#!/bin/sh
PACKAGE_SCOPE="$PWD"
while [  ! -f "$PACKAGE_SCOPE/package.json" ]; do
  NEXT_PACKAGE_SCOPE="$(dirname "$PACKAGE_SCOPE")"
  if [ "$NEXT_PACKAGE_SCOPE" == "$PACKAGE_SCOPE" ]; then
    $PACKAGE_SCOPE=""
    break
  fi
  PACKAGE_SCOPE="$NEXT_PACKAGE_SCOPE"
done

LOCAL_BIN="$PACKAGE_SCOPE/jspm_packages/.bin/$(basename $0)"
if [ ! -z $PACKAGE_SCOPE ] && [ -f "$LOCAL_BIN" ]; then
  $LOCAL_BIN
  ret=$?
  exit $ret
fi

JSPM_DIR="$(dirname $(which jspm 2>/dev/null || echo "."))"
if [ "$JSPM_DIR" == "." ]; then
  echo "jspm not found in path, make sure it is installed."
  exit 1
fi
JSPM_LOADER=("$(dirname $JSPM_DIR)/npm/@jspm/resolve@*/loader.mjs")
if [ ! -f "$JSPM_LOADER" ]; then
  JSPM_LOADER="$JSPM_DIR/node_modules/jspm/node_modules/@jspm/resolve/loader.mjs"
  if [ ! -f "$JSPM_LOADER" ]; then
    JSPM_LOADER="$JSPM_DIR/node_modules/@jspm/resolve/loader.mjs"
    if [ ! -f "$JSPM_LOADER" ]; then
      echo "jspm resolver not found."
      exit 1
    fi
  fi
fi

case "$(uname -s)" in
  CYGWIN*|MINGW32*|MINGW64*)
    JSPM_LOADER="file:///$(cygpath -w "$JSPM_LOADER")"
    BASE_DIR="$(cygpath -aw "$BASE_DIR")"
    ;;
  *)
esac
JSPM_BIN=global NODE_OPTIONS="--experimental-modules --no-warnings --loader $JSPM_LOADER" node "$BASE_DIR/${binModulePath.replace(/\\/g, '/')}" "$@"
ret=$?
exit $ret
`;

// Note cannot set locals in loops in batch files!
const localWinBin = (binModulePath: string) => `@setlocal
@set PACKAGE_SCOPE="%cd%"
:scopeloop
@if not exist %PACKAGE_SCOPE%\\package.json (
  @for %%n in (%PACKAGE_SCOPE%\\..) do @(
    @if "%%~fn"=="%PACKAGE_SCOPE%" (
      @set PACKAGE_SCOPE=""
      @goto scopedone
    )
    @set PACKAGE_SCOPE=%%~fn
    @goto scopeloop
  )
)
:scopedone

@set JSPM_LOADER=""
@for /d %%n in ("%PACKAGE_SCOPE%\\jspm_packages\\npm\\@jspm\\resolve@*") do @(
  @set JSPM_LOADER=%%~fn\\loader.mjs
)
@if "%JSPM_LOADER%" == "" (
  @for %%X in (jspm) do @(
    @for /d %%n in ("%%~dp$PATH:X..\\npm\\@jspm\\resolve@*") do @(
      @set JSPM_LOADER=%%~fn\\loader.mjs
    )
  )
)
@if not exist "%JSPM_LOADER%" (
  @for %%X in (jspm) do @(
    @set JSPM_LOADER=%%~dp$PATH:Xnode_modules\\jspm\\node_modules\\@jspm\\resolve\\loader.mjs
  )
)
@if not exist "%JSPM_LOADER%" (
  @for %%X in (jspm) do @(
    @set JSPM_LOADER=%%~dp$PATH:Xnode_modules\\@jspm\\resolve\\loader.mjs
  )
)
@if not exist "%JSPM_LOADER%" (
  @echo jspm resolver not found.
  @exit /B 1
)
@set NODE_OPTIONS=--experimental-modules --no-warnings --loader "file:///%JSPM_LOADER:\\=/%"
@set JSPM_BIN=local
@node "%~dp0\\..\\${binModulePath}" %*
`;

const globalWinBin = (binModulePath: string) => `@setlocal
@set PACKAGE_SCOPE="%cd%"
:scopeloop
@if not exist %PACKAGE_SCOPE%\\package.json (
  @for %%n in (%PACKAGE_SCOPE%\\..) do @(
    @if "%%~fn"=="%PACKAGE_SCOPE%" (
      @set PACKAGE_SCOPE=""
      @goto scopedone
    )
    @set PACKAGE_SCOPE=%%~fn
    @goto scopeloop
  )
)
:scopedone

@if exist "%PACKAGE_SCOPE%/jspm_packages/.bin/%~nx0" (
  "%PACKAGE_SCOPE%/jspm_packages/.bin/%~nx0"
)
LOCAL_BIN="$PACKAGE_SCOPE/jspm_packages/.bin/$(basename $0)"
if [ ! -z $PACKAGE_SCOPE ] && [ -f "$LOCAL_BIN" ]; then
  $LOCAL_BIN
  ret=$?
  exit $ret
fi

@set JSPM_LOADER=""
@for %%X in (jspm) do @(
  @for /d %%n in ("%%~dp$PATH:X..\\npm\\@jspm\\resolve@*") do @(
    @set JSPM_LOADER=%%~fn\\loader.mjs
  )
)
@if "%JSPM_LOADER%" == "" (
  @for %%X in (jspm) do @(
    @set JSPM_LOADER=%%~dp$PATH:Xnode_modules\\jspm\\node_modules\\@jspm\\resolve\\loader.mjs
  )
)
@if not exist "%JSPM_LOADER%" (
  @for %%X in (jspm) do @(
    @set JSPM_LOADER=%%~dp$PATH:Xnode_modules\\@jspm\\resolve\\loader.mjs
  )
)
@if not exist "%JSPM_LOADER%" (
  @echo jspm resolver not found.
  @exit /B 1
)

@for %%X in (jspm) do @(set JSPM_PATH=%%~dp$PATH:X)
@if "%JSPM_PATH%"=="" (
  @echo jspm not found in path, make sure it is installed.
  @exit /B 1
)

@set NODE_OPTIONS=--experimental-modules --no-warnings --loader "file:///%JSPM_LOADER:\\=/%"
@set JSPM_BIN=global
@node "%~dp0\\..\\${binModulePath}" %*
`;

export function getBin () {
  let loader = path.dirname(require.resolve('@jspm/resolve')) + '/loader.mjs';
  if (isWindows)
    loader = 'file:///' + loader.replace(/\\/g, '/');
  if (isWindows && !isCygwin())
    return `set NODE_OPTIONS=--experimental-modules --no-warnings --loader ${loader} && node`
  else
    return `NODE_OPTIONS="--experimental-modules --no-warnings --loader ${loader}" node`;
}
