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

cli.usage("[command] [options]").version(version).help();

cli.command("").action(cli.outputHelp);

cli
  .command("install [...packages]", "install packages")
  .alias("i")
  .option(...mapOpt)
  .option(...outputOpt)
  .option(...envOpt)
  .option(...resolutionOpt)
  .option(...providerOpt)
  .option(...stdoutOpt)
  .option(...compactOpt)
  .action(wrapCommand(install));

cli
  .command("uninstall [...packages]", "remove packages")
  .option(...mapOpt)
  .option(...outputOpt)
  .option(...envOpt)
  .option(...resolutionOpt)
  .option(...providerOpt)
  .option(...stdoutOpt)
  .option(...compactOpt)
  .action(wrapCommand(uninstall));

cli
  .command("link [...modules]", "link modules")
  .alias("trace")
  .option(...mapOpt)
  .option(...outputOpt)
  .option(...envOpt)
  .option(...resolutionOpt)
  .option(...providerOpt)
  .option(...stdoutOpt)
  .option(...compactOpt)
  .action(wrapCommand(link));

cli
  .command("update [...packages]", "update packages")
  .alias("upgrade")
  .option(...mapOpt)
  .option(...outputOpt)
  .option(...envOpt)
  .option(...resolutionOpt)
  .option(...providerOpt)
  .option(...stdoutOpt)
  .option(...compactOpt)
  .action(wrapCommand(update));

cli
  .command("clear-cache", "clear the local package cache")
  .alias("cc")
  .action(wrapCommand(clearCache));
