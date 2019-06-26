jspm 2.0.0-beta.6 (26/06/2019)
- Fixup isArray check in build (https://github.com/jspm/jspm-cli/pull/2482)

jspm 2.0.0-beta.5 (24/06/2019)
- Support install aliases with "@" characters (https://github.com/jspm/jspm-cli/pull/2480, by @Hypercubed)
- Fixup Rollup builds to correctly match up chunks in import map generation (https://github.com/jspm/jspm-cli/pull/2477, by @jbanety)

jspm 2.0.0-beta.4 (20/05/2019)
- Support GitHub installs without login by default (https://github.com/jspm/jspm-cli/issues/2429) 
- Fix a bug with dynamic import tracing in `jspm trace` and `jspm map` (https://github.com/jspm/jspm-cli/issues/2475)
- Fixes support for TypeScript being run through jspm ES module conversion (https://github.com/jspm/jspm-cli/issues/2452)
- Support for flags in `jspm bin` commands (https://github.com/jspm/jspm-cli/issues/2431)
- Add '(jspm)' to errors and warnings (https://github.com/jspm/jspm-cli/commit/664cd2c647520a51308257f0f3dedc9270735a39)
- Fix --deps to only list dependencies (https://github.com/jspm/jspm-cli/pull/2472, @jbanety)
- Fix builds of multiple entry points by fixing Rollup output matching (https://github.com/jspm/jspm-cli/issues/2468, @jbanety)
- Support for global CLI options like `--offline` etc through `JSPM_OFFLINE` etc environment variables (https://github.com/jspm/jspm-cli/commit/c3f2fe585c82d56af96c95bfb4580f77feaece52)
- 

jspm 2.0 changelogs started as of 2.0.0-beta.4.

For previous jspm releases see https://github.com/jspm/jspm-cli/releases.
