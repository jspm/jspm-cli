import cac from 'cac'
import { version } from '../package.json'
import extract from './extract'
import inject from './inject'
import install from './install'
import traceInstall from './traceInstall'
import uninstall from './uninstall'
import update from './update'

const cli = cac('jspm')

cli
  .version(version)
  .option('-r, --resolution <resolutions>', 'custom dependency resolution overrides for all installs')
  .option('-e, --env <environments>', 'the conditional environment resolutions to apply')
  .option('-m, --map <map>', 'an authoritative initial import map', { default: 'importmap.json' })
  .option('--force', 'force install even if the import map is up to date', { default: false })
  .option('--stdout', 'output the import map to stdout', { default: false })
  .option('--preload', 'preload the import map into the browser', { default: false })
  .option('--integrity', 'generate integrity hashes for all dependencies', { default: false })
  .option('--compact', 'output a compact import map', { default: false })
  .help()

cli
  .command('install [...packages]', 'install packages')
  .option('-o, --output <outputFile>', '.json or .importmap file for the output import-map')
  .action(install)

cli
  .command('update [...packages]', 'update packages')
  .option('-o, --output <outputFile>', '.json or .importmap file for the output import-map')
  .action(update)

cli
  .command('uninstall [...packages]', 'remove packages')
  .option('-o, --output <outputFile>', '.json or .importmap file for the output import-map')
  .action(uninstall)

cli
  .command('trace-install [...modules]', 'trace install modules')
  .option('-o, --output <outputFile>', '.json or .importmap file for the output import-map')
  .action(traceInstall)

cli
  .command('inject <htmlFile> [...packages]', 'inject the import map into the provided HTML source')
  .option('-o, --output <outputFile>', '.html file for the output html with the import-map')
  .action(inject)

cli
  .command('extract [...packages]', 'extract packages from the import map')
  .option('-o, --output <outputFile>', '.json or .importmap file for the output import-map')
  .action(extract)

cli
  .command('')
  .action(cli.outputHelp)

function noArgs() {
  if (cli.args.length === 0) {
    cli.outputHelp()
    process.exit(1)
  }
}

['uninstall', 'trace-install', 'inject', 'extract'].forEach(command => cli.on(`command:${command}`, noArgs))

cli.on('command:*', () => {
  console.error('Invalid command: %s', cli.args.join(' '))
  cli.outputHelp()
  process.exit(1)
})

cli.parse()
