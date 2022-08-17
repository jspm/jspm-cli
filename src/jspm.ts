import { Generator } from '@jspm/generator';
import { parse } from "https://deno.land/std@0.119.0/flags/mod.ts";

const flags = parse(Deno.args, {
  alias: {
    'o': 'output',
    'e': 'env'
  },
  boolean: ['force', 'stdout'],
  string: ['map', 'env', 'output'],
  default: {
    force: false
  },
});

const cmd = flags._[0];

async function getInputMap (flags) {
  let inMap = '{}';
  try {
    inMap = await Deno.readTextFile(flags.map || 'importmap.json');
  }
  catch (e) {
    if (flags.map)
      throw e;
    return {};
  }
  return JSON.parse(inMap);
}

async function writeMap (map, flags, defaultStdout = false) {
  const output = JSON.stringify(map, null, 2);
  if (!flags.output && (defaultStdout || flags.stdout)) {
    console.log(output);
  }
  else {
    const outfile = flags.output || flags.map || 'importmap.json';
    if (outfile.endsWith('.html'))
      throw new Error('ABSOLUTELY NECESSARY TODO: HTML OUTPUT');
    await Deno.writeTextFile(outfile, output);
    console.error(`%cOK: %cUpdated %c${outfile}`, 'color: green', 'color: black', 'font-weight: bold');
  }
}

function getEnv (flags) {
  const env = ['development', 'deno', 'node', 'module'];
  const envFlags = Array.isArray(flags.env) ? flags.env : (flags.env || '').split(',').map(e => e.trim());
  for (const name of envFlags) {
    switch (name) {
      case 'nodeno':
      case 'nomodule':
      case 'nonode':
        env.splice(env.indexOf(name.slice(2)), 1);
        break;
      case 'browser':
        env.splice(env.indexOf('deno'), 1);
        env.splice(env.indexOf('node'), 1);
        env.push('browser');
        break;
      case 'production':
        env.splice(env.indexOf('development'), 1);
        env.push('production');
        break;
      case 'node':
        env.splice(env.indexOf('deno'), 1);
        break;
      case 'deno':
      case 'development':
      case 'module':
        break;
      default:
        env.push(name);
        break;
    }
  }
  return env;
}

try {
  switch (cmd) {
    case 'checkout':
      throw new Error('Absolutely necessary TODO');
    case 'pin':
      throw new Error('Custom pins absolutely necessary TODO');
    case 'install': {
      const args = flags._.slice(1);
      const generator = new Generator({
        inputMap: await getInputMap(flags),
        env: getEnv(flags)
      });
      console.error(`Installing ${args.join(', ')}...`);
      if (args.length)
        await generator.install(args);
      else
        await generator.reinstall();
      await writeMap(generator.getMap(), flags);
      break;
    }
    case 'uninstall': {
      const args = flags._.slice(1);
      const generator = new Generator({
        inputMap: await getInputMap(flags),
        env: getEnv(flags)
      });
      console.error(`Uninstalling ${args.join(', ')}...`);
      await generator.uninstall(args);
      await writeMap(generator.getMap(), flags);
      break; 
    }
    case 'pluck': {
      const args = flags._.slice(1);
      const generator = new Generator({
        inputMap: await getInputMap(flags),
        env: getEnv(flags)
      });
      console.error(`Plucking ${args.join(', ')}...`);
      const { map } = await generator.extractMap(args);
      await writeMap(map, flags, true);
      break;
    }
    case undefined:
      console.error('JSPM@2.0');
      break;
    default:
      throw new Error(`Unknown command ${flags._}.`);
  }
}
catch (e) {
  if (e.jspmError) {
    console.error(`%cERR: %c${e.message}`, 'color: red', 'color: black');
    Deno.exit(1);
  }
  throw e;
}

Deno.exit();
