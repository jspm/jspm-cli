- Run `node repro.js`
- See how `package.json` will contain `"multiversion": "testing:multiversion@^1.0.0"`
- Switch the lookup delays around so package-b resolves first
- Run `node repro.js`
- See how `package.json` will contain `"multiversion": "testing:multiversion@^1.1.0"`

Expected:

Always choose the stricter version. `package-a` wants `^1.0.0` and `package-b` wants `^1.1.0`. The correct behavior should be to always use the `^1.1.0`.
