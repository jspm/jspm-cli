/**
 * Copyright 2022-2023 Guy Bedford
 *
 *    Licensed under the Apache License, Version 2.0 (the "License");
 *    you may not use this file except in compliance with the License.
 *    You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 *    Unless required by applicable law or agreed to in writing, software
 *    distributed under the License is distributed on an "AS IS" BASIS,
 *    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *    See the License for the specific language governing permissions and
 *    limitations under the License.
 */

import c from "picocolors";
import cac from "cac";
import { version } from "../package.json";
import clearCache from "./clearCache";
import install from "./install";
import link from "./link";
import uninstall from "./uninstall";
import update from "./update";
import { JspmError, availableProviders, wrapCommand } from "./utils";
import build from "./build/index";

export const cli = cac(c.yellow("jspm"));

type opt = [string, string, any];
const mapOpt: opt = [
  "-m, --map <file>",
  "File containing initial import map",
  { default: "importmap.json" },
];
const envOpt: opt = [
  "-e, --env <environments>",
  "Comma-separated environment condition overrides",
  {},
];
const resolutionOpt: opt = [
  "-r, --resolution <resolutions>",
  "Comma-separated dependency resolution overrides",
  {},
];
const providerOpt: opt = [
  "-p, --provider <provider>",
  `Default module provider. Available providers: ${availableProviders.join(
    ", "
  )}`,
  {},
];
const stdoutOpt: opt = [
  "--stdout",
  "Output the import map to stdout",
  { default: false },
];
const compactOpt: opt = [
  "--compact",
  "Output a compact import map",
  { default: false },
];
const outputOpt: opt = [
  "-o, --output <file>",
  "File to inject the final import map into (default: --map / importmap.json)",
  {},
];
const preloadOpt: opt = [
  "--preload [mode]",
  "Add module preloads to HTML output (default: static, dynamic)",
  {},
];
const integrityOpt: opt = [
  "--integrity",
  "Add module preloads with integrity attributes to HTML output",
  { default: false },
];
const cacheOpt: opt = [
  "--cache <mode>",
  "Cache mode for fetches (online, offline, no-cache)",
  { default: "online" },
];
const rootOpt: opt = [
  "--root <url>",
  "URL to treat as server root, i.e. rebase import maps against",
  {},
];
const freezeOpt: opt = [
  "--freeze",
  "Freeze input map dependencies, i.e. do not modify them",
  { default: false },
];
const silentOpt: opt = ["--silent", "Silence all output", { default: false }];
const buildConfigOpt: opt = [
  "--config <file>",
  "Path to a rollup config file",
  {},
];
const buildOutputOpt: opt = [
  "--output <dir>",
  "Path to the rollup output directory",
  {},
];

cli
  .option(...silentOpt)
  .version(version)
  .help(defaultHelpCb);

// Fallback command:
cli
  .command("[...args]")
  .allowUnknownOptions()
  .usage("[command] [options]")
  .action(
    wrapCommand((args) => {
      if (!args.length) return cli.outputHelp();
      throw new JspmError(
        `Unknown command: ${args[0]}\nRun "jspm" without any arguments to see the help file.`
      );
    })
  );

cli
  .command("link [...modules]", "link modules")
  .alias("trace")
  .option(...mapOpt)
  .option(...outputOpt)
  .option(...envOpt)
  .option(...resolutionOpt)
  .option(...providerOpt)
  .option(...cacheOpt)
  .option(...rootOpt)
  .option(...preloadOpt)
  .option(...integrityOpt)
  .option(...compactOpt)
  .option(...freezeOpt)
  .option(...stdoutOpt)
  .example(
    (name) => `Link a remote package in importmap.json
  $ ${name} link chalk@5.2.0
`
  )
  .example(
    (name) => `Link a local module
  $ ${name} link ./src/cli.js
`
  )
  .example(
    (
      name
    ) => `Link an HTML file and update its import map including preload and integrity tags
  $ ${name} link --map index.html --integrity --preload dynamic
`
  )
  .usage(
    `link [flags] [...modules]

Traces and installs all dependencies necessary to execute the given modules into an import map, including both static and dynamic module imports. The given modules can be:
  1. Paths to local JavaScript modules, such as "./src/my-module.mjs".
  2. Paths to local HTML files, such as "index.html", in which case all module scripts in the file are linked.
  3. Valid package specifiers, such as \`react\` or \`chalk@5.2.0\`, in which case the package's main export is linked.
  4. Valid package specifiers with subpaths, such as \`sver@1.1.1/convert-range\`, in which case the subpath is resolved against the package's exports and the resulting module is linked.

In some cases there may be ambiguity. For instance, you may want to link the NPM package "app.js", but your working directory contains a local file called "app.js" as well. In these cases local files are preferred by default, and external packages must be prefixed with the "%" character (i.e. "%app.js").

If no modules are given, all "imports" in the initial map are relinked.`
  )
  .action(wrapCommand(link));

cli
  .command("install [...packages]", "install packages")
  .alias("i")
  .option(...mapOpt)
  .option(...outputOpt)
  .option(...envOpt)
  .option(...resolutionOpt)
  .option(...providerOpt)
  .option(...cacheOpt)
  .option(...rootOpt)
  .option(...preloadOpt)
  .option(...integrityOpt)
  .option(...compactOpt)
  .option(...freezeOpt)
  .option(...stdoutOpt)
  .example(
    (name) => `Install a package
  $ ${name} install lit
`
  )
  .example(
    (name) => `Install a versioned package and subpath
  $ ${name} install npm:lit@2.2.0/decorators.js
`
  )
  .example(
    (name) => `Install a versioned package
  $ ${name} install npm:react@18.2.0
`
  )
  .example(
    (name) => `Install a Denoland package and use the Deno provider
  $ ${name} install -p deno denoload:oak
`
  )
  .example(
    (name) => `Install "alias" as an alias of the resolution react
  $ ${name} install alias=react
`
  )
  .usage(
    `install [flags] [...packages]

Installs packages into an import map, along with all of the dependencies that are necessary to import them.` +
      `By default, the latest versions of the packages that are compatible with the local "package.json" are ` +
      `installed, unless an explicit version is specified. The given packages must be valid package specifiers, ` +
      `such as \`npm:react@18.0.0\` or \`denoland:oak\`. If a package specifier with no registry is given, such as ` +
      `\`lit\`, the registry is assumed to be NPM. Packages can be installed under an alias by using specifiers such ` +
      `as \`myname=npm:lit@2.1.0\`. An optional subpath can be provided, such as \`npm:lit@2.2.0/decorators.js\`, in ` +
      `which case only the dependencies for that subpath are installed.

If no packages are provided, all "imports" in the initial map are reinstalled.`
  )

  .action(wrapCommand(install));

cli
  .command("uninstall [...packages]", "remove packages")
  .option(...mapOpt)
  .option(...outputOpt)
  .option(...envOpt)
  .option(...resolutionOpt)
  .option(...providerOpt)
  .option(...cacheOpt)
  .option(...rootOpt)
  .option(...preloadOpt)
  .option(...integrityOpt)
  .option(...compactOpt)
  .option(...freezeOpt)
  .option(...stdoutOpt)
  .example(
    (name) => `
$ ${name} uninstall lit lodash

Uninstall "lit" and "lodash" from importmap.json.
`
  )
  .usage(
    `uninstall [flags] [...packages]

Uninstalls packages from an import map. The given packages must be valid package specifiers, such as \`npm:react@18.0.0\`, \`denoland:oak\` or \`lit\`, and must be present in the initial import map.`
  )
  .action(wrapCommand(uninstall));

cli
  .command("update [...packages]", "update packages")
  .alias("upgrade")
  .option(...mapOpt)
  .option(...outputOpt)
  .option(...envOpt)
  .option(...resolutionOpt)
  .option(...providerOpt)
  .option(...cacheOpt)
  .option(...rootOpt)
  .option(...preloadOpt)
  .option(...integrityOpt)
  .option(...compactOpt)
  .option(...freezeOpt)
  .option(...stdoutOpt)
  .example(
    (name) => `
$ ${name} update react-dom

Update the react-dom package.
`
  )
  .usage(
    `update [flags] [...packages]

Updates packages in an import map to the latest versions that are compatible with the local \`package.json\`. The given packages must be valid package specifiers, such as \`npm:react@18.0.0\`, \`denoland:oak\` or \`lit\`, and must be present in the initial import map.`
  )
  .action(wrapCommand(update));

cli
  .command("clear-cache", "clear the local package cache")
  .usage(
    `clear-cache

Clears the global module fetch cache, for situations where the contents of a dependency may have changed without a version bump. This can happen during local development, for instance.`
  )
  .alias("cc")
  .action(wrapCommand(clearCache));

cli
  .command("build [entry]", "Build the module using importmap")
  .option(...resolutionOpt)
  .option(...buildConfigOpt)
  .option(...buildOutputOpt)
  .action(wrapCommand(build));

// Taken from 'cac', as they don't export it:
interface HelpSection {
  title?: string;
  body: string;
}

// Wraps the CAC default help callback for more control over the output:
function defaultHelpCb(helpSections: HelpSection[]) {
  for (const section of Object.values(helpSections)) {
    if (section.title === "Commands") {
      // The first command entry is the fallback command, which we _don't_
      // want to display on the help screen, as it's for throwing on invalid
      // commands:
      section.body = section.body.split("\n").slice(1).join("\n");
    }
  }

  for (const section of Object.values(helpSections)) {
    if (section.title) section.title = c.bold(section.title);
  }

  return helpSections;
}
