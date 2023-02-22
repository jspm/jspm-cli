import c from "picocolors";
import cac from "cac";
import { version } from "../package.json";
import clearCache from "./clearCache";
import install from "./install";
import link from "./link";
import uninstall from "./uninstall";
import update from "./update";
import { wrapCommand } from "./utils";

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
  "Default module provider",
  { default: "jspm" },
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
  "File to inject the final import map into",
  {},
];
const preloadOpt: opt = [
  "--preload",
  "Add module preloads to HTML output",
  { default: false },
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
const silentOpt: opt = ["--silent", "Silence all output", { default: false }];

cli
  .usage("[command] [options]")
  .option(...silentOpt)
  .version(version)
  .help();

cli.command("").action(cli.outputHelp);

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
  .option(...integrityOpt)
  .option(...preloadOpt)
  .option(...compactOpt)
  .option(...stdoutOpt)
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
  .option(...integrityOpt)
  .option(...preloadOpt)
  .option(...compactOpt)
  .option(...stdoutOpt)
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
  .option(...integrityOpt)
  .option(...preloadOpt)
  .option(...compactOpt)
  .option(...stdoutOpt)
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
  .option(...integrityOpt)
  .option(...preloadOpt)
  .option(...compactOpt)
  .option(...stdoutOpt)
  .action(wrapCommand(update));

cli
  .command("clear-cache", "clear the local package cache")
  .alias("cc")
  .action(wrapCommand(clearCache));
