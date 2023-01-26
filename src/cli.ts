import c from 'picocolors'
import cac from 'cac'
import { version } from '../package.json'
import clearCache from './clearCache'
import extract from './extract'
import inject from './inject'
import install from './install'
import link from './link'
import uninstall from './uninstall'
import update from './update'
import { wrapCommandAndRemoveStack } from './utils'

const cli = cac(c.yellow('jspm'))

cli
  .usage('[command] [options]')
  .version(version)
  .option('-r, --resolution <resolutions>', 'custom dependency resolution overrides for all installs')
  .option('-e, --env <environments>', 'the conditional environment resolutions to apply')
  .option('-m, --map <map>', 'an authoritative initial import map', { default: 'importmap.json' })
  .option('-p, --provider <proider>', 'the default provider to use for a new install, defaults to `jspm`', { default: 'jspm' })
  .option('--force', 'force install even if the import map is up to date', { default: false })
  .option('--stdout', 'output the import map to stdout', { default: false })
  .option('--compact', 'output a compact import map', { default: false })
  .help()

cli
  .command('install [...packages]', 'install packages')
  .option('-o, --output <outputFile>', '.json or .importmap file for the output import-map')
  .action(wrapCommandAndRemoveStack(install))

cli
  .command('update [...packages]', 'update packages')
  .option('-o, --output <outputFile>', '.json or .importmap file for the output import-map')
  .action(wrapCommandAndRemoveStack(update))

cli
  .command('uninstall [...packages]', 'remove packages')
  .option('-o, --output <outputFile>', '.json or .importmap file for the output import-map')
  .action(wrapCommandAndRemoveStack(uninstall))

cli
  .command('link [...modules]', 'trace install modules')
  .option('-o, --output <outputFile>', '.json or .importmap file for the output import-map')
  .action(wrapCommandAndRemoveStack(link))

cli
  .command('inject <htmlFile>', 'inject the import map into the given HTML file')
  .option('-p, --packages <...packages>', 'specific list of packages to extract for injection', { type: [] })
  .option('--preload', 'preload the import map into the browser', { default: false })
  .option('--integrity', 'generate integrity hashes for all dependencies', { default: false })
  .option('-o, --output <outputFile>', '.html file for the output html with the import-map')
  .action(wrapCommandAndRemoveStack(inject))

cli
  .command('extract [...packages]', 'extract packages from the import map')
  .option('-o, --output <outputFile>', '.json or .importmap file for the output import-map')
  .action(wrapCommandAndRemoveStack(extract))

cli
  .command('clear-cache', 'Clear the local package cache')
  .action(wrapCommandAndRemoveStack(clearCache))

cli
  .command('')
  .action(() => {
    if (cli.args.length)
      console.error(`${c.red('Error:')} Invalid command ${c.bold(cli.args.join(' '))}\n`)
    else
      console.error(`${c.red('Error:')} No command provided\n`)
    cli.outputHelp()
    process.exit(1)
  })

function noArgs() {
  if (cli.args.length === 0) {
    cli.outputHelp()
    process.exit(1)
  }
}

['uninstall', 'link', 'extract'].forEach(command => cli.on(`command:${command}`, noArgs))

// short commands and other hacks
switch (process.argv[2]) {
  case 'cc':
    process.argv[2] = 'clear-cache'
    break
  case 'inject': {
    let pIndex = process.argv.indexOf('-p', 2)
    if (pIndex === -1)
      pIndex = process.argv.indexOf('--packages', 2)
    if (pIndex !== -1) {
      const pArgs = process.argv.splice(pIndex)
      for (let i = 0; i < pArgs.length; i++) {
        if (pArgs[i] === '-p' || pArgs[i] === '--packages')
          continue
        if (pArgs[i].startsWith('-')) {
          console.error(`${c.red('Err:')} --packages flag must be the last flag\n`)
          process.exit(1)
        }
        if (pArgs[i - 1] !== '-p' && pArgs[i - 1] !== '--packages') {
          pArgs.splice(i, 0, '-p')
          i++
        }
      }
      process.argv.splice(pIndex, pArgs.length, ...pArgs)
    }
  }
}

try {
  cli.parse()
}
catch (e) {
  if (e.constructor.name === 'CACError')
    console.error(`${c.red('Err:')} ${e.message}\n`)
}
