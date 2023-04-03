The JSPM CLI is the main command-line import map package management tool for JSPM.

> For a complete guide and introduction to the JSPM CLI and import map package management, see the [getting started guide](/getting-started).

For import map generation API usage or in other environments, see the low-level [Generator API](/docs/generator/stable/) which is the internal import map package management and generation API which this CLI project wraps. The [Generator API documentation](/docs/generator/stable/) also provides a more thorough details of the operations.

## Installation

The following command installs JSPM globally:

```
npm install -g jspm
```

# Commands

For a full list of commands and supported options, run `jspm --help`. For help with a specific command, add the `-h` or `--help` flag to the command invocation.

By default, JSPM operates on `importmap.json` which is automatically created if it does not exist. This is considered the main import map on which link and install operations are being performed, and can be customized with the `--map` option.
