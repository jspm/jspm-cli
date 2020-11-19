#!/usr/bin/env -S deno run --allow-all --no-check --unstable --importmap jspm.importmap

const cli = (await import('./cli.ts')).cli;
const [,, cmd, ...rawArgs] = Deno.args;
await cli(cmd, rawArgs);
