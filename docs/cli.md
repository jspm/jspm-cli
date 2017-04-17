## Getting Help

```sh
jspm --help
```

## Bundles

```sh
jspm bundle moduleA + module/b [outfile] [flags]
```

| Flag                        | Description  | JS API Equivalent|
| ----------------------------|---------------| -------------------| 
| `--minify`                    | minify the bundle using uglify-js | `minify` |
| `--no-mangle`                 | applies if --minify is true, mangle the source code or node | `mangle`
| `--inject`                    | whether to inject the bundle into config.js | `inject`
| `--skip-source-maps`          | skips source maps generation | `sourceMaps`
| `--source-map-contents`       | adds `sourcesContent` into the source map | `sourceMapContents`

## SFX Bundles

```sh
jspm bundle-sfx moduleA + module/b [outfile] [flags]
```

| Flag                        | Description  | JS API Equivalent|
| ----------------------------|---------------| -------------------| 
| `--minify`                    | minify the bundle using uglify-js | `minify` |
| `--format`                    | sfx module format <amd|cjs|global> | `format` 

## Global Flags

| Flag                        | Description  |
| ----------------------------|---------------|
| --yes &#124; -y                 | Skip prompts / use default inputs |
| --log <ok&#124;warn&#124;err>       |Set log level|
