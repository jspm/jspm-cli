import c from "picocolors";
import cac from "cac";
import { version } from "../package.json";
import clearCache from "./clearCache";
import install from "./install";
import link from "./link";
import uninstall from "./uninstall";
import update from "./update";
import { wrapCommandAndRemoveStack } from "./utils";

export const cli = cac(c.yellow("jspm"));

cli
  .usage("[command] [options]")
  .version(version)
  .option(
    "-m, --map <file>",
    "file to use as authoritative initial import map",
    { default: "importmap.json" }
  )
  .option(
    "-e, --env <environments>",
    "the conditional environment resolutions to apply"
  )
  .option(
    "-p, --provider <provider>",
    "the default provider to use for a new install, defaults to `jspm`",
    { default: "jspm" }
  )
  .option(
    "-r, --resolution <resolutions>",
    "custom dependency resolution overrides for all installs"
  )
  .option("--force", "force install even if the import map is up to date", {
    default: false,
  })
  .option("--stdout", "output the import map to stdout", { default: false })
  .option("--compact", "output a compact import map", { default: false })
  .help();

cli
  .command("install [...packages]", "install packages")
  .option("-o, --output <file>", "file to inject the final import map into")
  .action(wrapCommandAndRemoveStack(install));
  

cli
  .command("uninstall [...packages]", "remove packages")
  .option("-o, --output <file>", "file to inject the final import map into")
  .action(wrapCommandAndRemoveStack(uninstall));

cli
  .command("link [...modules]", "trace install modules")
  .alias("trace")
  .option("-o, --output <file>", "file to inject the final import map into")
  .action(wrapCommandAndRemoveStack(link));

cli
  .command("update [...packages]", "update packages")
  .alias("upgrade")
  .option("-o, --output <file>", "file to inject the final import map into")
  .action(wrapCommandAndRemoveStack(update));

cli
  .command("clear-cache", "clear the local package cache")
  .action(wrapCommandAndRemoveStack(clearCache));

// Help the user if they don't provide a command to run:
cli.command("").action(() => {
  if (cli.args.length)
    console.error(
      `${c.red("Error:")} Invalid command ${c.bold(cli.args.join(" "))}\n`
    );
  else console.error(`${c.red("Error:")} No command provided\n`);
  cli.outputHelp();
  process.exit(1);
});

// Handler that ensures some commands always receive input:
{
  function noArgs() {
    if (cli.args.length === 0) {
      cli.outputHelp();
      process.exit(1);
    }
  }

  ["uninstall"].forEach((command) => cli.on(`command:${command}`, noArgs));
}

// Hacks and small tweaks to the input arguments. Should be run before
// calling cli.parse().
export function patchArgs(argv: string[]) {
  switch (argv[2]) {
    case "cc":
      argv[2] = "clear-cache";
      break;
    case "inject": {
      let pIndex = argv.indexOf("-p", 2);
      if (pIndex === -1) pIndex = argv.indexOf("--packages", 2);
      if (pIndex !== -1) {
        const pArgs = argv.splice(pIndex);
        for (let i = 0; i < pArgs.length; i++) {
          if (pArgs[i] === "-p" || pArgs[i] === "--packages") continue;
          if (pArgs[i].startsWith("-")) {
            console.error(
              `${c.red("Err:")} --packages flag must be the last flag\n`
            );
            process.exit(1);
          }
          if (pArgs[i - 1] !== "-p" && pArgs[i - 1] !== "--packages") {
            pArgs.splice(i, 0, "-p");
            i++;
          }
        }
        argv.splice(pIndex, pArgs.length, ...pArgs);
      }
    }
  }
}
