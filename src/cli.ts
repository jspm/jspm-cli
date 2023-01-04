import cac from 'cac'
import extract from './extract'
import inject from './inject'
import install from './install'
import traceInstall from './traceInstall'
import uninstall from './uninstall'
import update from './update'

const cli = cac('jspm')

cli
  .option('-r, --resolution <resolutions>', 'custom dependency resolution overrides for all installs')
  .option('-e, --env <environments>', 'the conditional environment resolutions to apply')
  .option('-m, --map <map>', 'an authoritative initial import map')
  .option('-o, --output <outputFile>', '.json or .importmap file for the output import-map')
  .option('--force', 'force install even if the import map is up to date', { default: false })
  .option('--stdout', 'output the import map to stdout', { default: false })
  .option('--preload', 'preload the import map into the browser', { default: false })
  .option('--integrity', 'generate integrity hashes for all dependencies', { default: false })
  .option('--compact', 'output a compact import map', { default: false })
  .help()

cli
  .command('i [...packages]', 'install packages')
  .action(install)

cli
  .command('install [...packages]', 'install packages')
  .action(install)

cli
  .command('update [...packages]', 'update packages')
  .action(update)

cli
  .command('uninstall [...packages]', 'remove packages')
  .action(uninstall)

cli
  .command('ti [...modules]', 'trace install modules')
  .action(traceInstall)

cli
  .command('trace-install [...modules]', 'trace install modules')
  .action(traceInstall)

cli
  .command('inject <htmlFile> [...packages]', 'inject the import map into the provided HTML source')
  .action(inject)

cli
  .command('e [...packages]', 'extract packages from the import map')
  .action(extract)

cli
  .command('extract [...packages]', 'extract packages from the import map')
  .action(extract)

cli.parse()
