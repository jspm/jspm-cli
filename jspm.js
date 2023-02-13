#!/usr/bin/env node
import c from "picocolors";
import { cli, patchArgs } from './dist/cli.js'

try {
  patchArgs(process.argv)
  cli.parse();
} catch (e) {
  if (e.constructor.name === "CACError")
    console.error(`${c.red("Err:")} ${e.message}\n`);
}
