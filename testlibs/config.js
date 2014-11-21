System.config({
  "paths": {
    "*": "*.js",
    "github:*": "jspm_packages/github/*.js",
    "npm:*": "jspm_packages/npm/*.js"
  }
});

System.config({
  "map": {
    "angular": "github:angular/bower-angular@1.3.3",
    "bootstrap": "github:twbs/bootstrap@3.3.1",
    "css": "github:systemjs/plugin-css@0.1.0",
    "d3": "github:mbostock/d3@3.4.13",
    "jquery": "github:components/jquery@2.1.1",
    "mocha": "npm:mocha@1.21.5",
    "text": "github:systemjs/plugin-text@0.0.2",
    "voxel-demo": "npm:voxel-demo@0.0.1",
    "github:jspm/nodelibs@0.0.5": {
      "Base64": "npm:Base64@0.2.1",
      "base64-js": "npm:base64-js@0.0.4",
      "ieee754": "npm:ieee754@1.1.4",
      "inherits": "npm:inherits@2.0.1",
      "json": "github:systemjs/plugin-json@0.1.0",
      "pbkdf2-compat": "npm:pbkdf2-compat@2.0.1",
      "ripemd160": "npm:ripemd160@0.2.0",
      "sha.js": "npm:sha.js@2.3.0"
    },
    "github:twbs/bootstrap@3.3.1": {
      "css": "github:systemjs/plugin-css@0.1.0",
      "jquery": "github:components/jquery@2.1.1"
    },
    "npm:ao-mesher@0.2.10": {
      "cwise-compiler": "npm:cwise-compiler@0.1.0",
      "greedy-mesher": "npm:greedy-mesher@1.0.2",
      "ndarray": "npm:ndarray@1.0.15",
      "typedarray-pool": "npm:typedarray-pool@0.1.2"
    },
    "npm:ao-shader@0.2.3": {
      "brfs": "npm:brfs@0.0.9",
      "gl-shader": "npm:gl-shader@0.0.6"
    },
    "npm:brfs@0.0.9": {
      "escodegen": "npm:escodegen@0.0.17",
      "falafel": "npm:falafel@0.1.6",
      "json": "npm:json@9.0.2",
      "through": "npm:through@2.2.7"
    },
    "npm:cwise-compiler@0.0.0": {
      "uniq": "npm:uniq@0.0.2"
    },
    "npm:cwise-compiler@0.1.0": {
      "uniq": "npm:uniq@0.0.2"
    },
    "npm:cwise-parser@0.0.1": {
      "esprima": "npm:esprima@1.0.4",
      "uniq": "npm:uniq@0.0.2"
    },
    "npm:cwise@0.3.4": {
      "cwise-compiler": "npm:cwise-compiler@0.0.0",
      "cwise-parser": "npm:cwise-parser@0.0.1"
    },
    "npm:debug@2.0.0": {
      "ms": "npm:ms@0.6.2"
    },
    "npm:escodegen@0.0.17": {
      "esprima": "npm:esprima@1.0.4",
      "estraverse": "npm:estraverse@0.0.4",
      "source-map": "npm:source-map@0.1.40"
    },
    "npm:falafel@0.1.6": {
      "esprima": "npm:esprima@1.0.4"
    },
    "npm:game-shell@0.1.4": {
      "domready": "npm:domready@0.2.13",
      "invert-hash": "npm:invert-hash@0.0.0",
      "iota-array": "npm:iota-array@0.0.1",
      "lower-bound": "npm:lower-bound@0.0.3",
      "uniq": "npm:uniq@0.0.2",
      "vkey": "npm:vkey@0.0.3"
    },
    "npm:gl-buffer@0.1.2": {
      "ndarray": "npm:ndarray@1.0.15",
      "ndarray-ops": "npm:ndarray-ops@1.1.1",
      "typedarray-pool": "npm:typedarray-pool@0.1.2"
    },
    "npm:gl-now@0.0.4": {
      "game-shell": "npm:game-shell@0.1.4",
      "webglew": "npm:webglew@0.0.0"
    },
    "npm:gl-shader@0.0.6": {
      "glsl-exports": "npm:glsl-exports@0.0.0",
      "uniq": "npm:uniq@0.0.2"
    },
    "npm:gl-texture2d@0.1.12": {
      "bit-twiddle": "npm:bit-twiddle@0.0.2",
      "cwise-compiler": "npm:cwise-compiler@0.1.0",
      "ndarray": "npm:ndarray@1.0.15",
      "ndarray-ops": "npm:ndarray-ops@1.1.1",
      "typedarray-pool": "npm:typedarray-pool@1.1.0",
      "webglew": "npm:webglew@0.0.0"
    },
    "npm:gl-tile-map@0.3.0": {
      "gl-texture2d": "npm:gl-texture2d@0.1.12",
      "ndarray": "npm:ndarray@1.0.15",
      "tile-mip-map": "npm:tile-mip-map@0.2.1",
      "webglew": "npm:webglew@0.0.0"
    },
    "npm:gl-vao@0.0.3": {
      "webglew": "npm:webglew@0.0.0"
    },
    "npm:glob@3.2.3": {
      "graceful-fs": "npm:graceful-fs@2.0.3",
      "inherits": "npm:inherits@2.0.1",
      "json": "npm:json@9.0.2",
      "minimatch": "npm:minimatch@0.2.14"
    },
    "npm:glsl-exports@0.0.0": {
      "glsl-parser": "npm:glsl-parser@0.0.9",
      "glsl-tokenizer": "npm:glsl-tokenizer@0.0.9",
      "through": "npm:through@2.3.6"
    },
    "npm:glsl-parser@0.0.9": {
      "glsl-tokenizer": "npm:glsl-tokenizer@0.0.9",
      "through": "npm:through@1.1.2"
    },
    "npm:glsl-tokenizer@0.0.9": {
      "through": "npm:through@2.3.6"
    },
    "npm:greedy-mesher@1.0.2": {
      "iota-array": "npm:iota-array@1.0.0",
      "typedarray-pool": "npm:typedarray-pool@1.1.0",
      "uniq": "npm:uniq@1.0.1"
    },
    "npm:jade@0.26.3": {
      "commander": "npm:commander@0.6.1",
      "mkdirp": "npm:mkdirp@0.3.0"
    },
    "npm:minimatch@0.2.14": {
      "lru-cache": "npm:lru-cache@2.5.0",
      "sigmund": "npm:sigmund@1.0.0"
    },
    "npm:mkdirp@0.5.0": {
      "minimist": "npm:minimist@0.0.8"
    },
    "npm:mocha@1.21.5": {
      "commander": "npm:commander@2.3.0",
      "debug": "npm:debug@2.0.0",
      "diff": "npm:diff@1.0.8",
      "escape-string-regexp": "npm:escape-string-regexp@1.0.2",
      "glob": "npm:glob@3.2.3",
      "growl": "npm:growl@1.8.1",
      "jade": "npm:jade@0.26.3",
      "mkdirp": "npm:mkdirp@0.5.0"
    },
    "npm:ndarray-downsample2x@0.1.1": {
      "cwise": "npm:cwise@0.3.4",
      "ndarray-fft": "npm:ndarray-fft@0.1.0",
      "ndarray-ops": "npm:ndarray-ops@1.1.1",
      "ndarray-scratch": "npm:ndarray-scratch@0.0.1"
    },
    "npm:ndarray-fft@0.1.0": {
      "bit-twiddle": "npm:bit-twiddle@0.0.2",
      "cwise": "npm:cwise@0.3.4",
      "ndarray": "npm:ndarray@1.0.15",
      "ndarray-ops": "npm:ndarray-ops@1.1.1",
      "typedarray-pool": "npm:typedarray-pool@0.1.2"
    },
    "npm:ndarray-fill@0.1.0": {
      "cwise": "npm:cwise@0.3.4"
    },
    "npm:ndarray-ops@1.1.1": {
      "cwise-compiler": "npm:cwise-compiler@0.0.0"
    },
    "npm:ndarray-scratch@0.0.1": {
      "ndarray": "npm:ndarray@1.0.15",
      "typedarray-pool": "npm:typedarray-pool@0.1.2"
    },
    "npm:ndarray@1.0.15": {
      "iota-array": "npm:iota-array@1.0.0"
    },
    "npm:source-map@0.1.40": {
      "amdefine": "npm:amdefine@0.0.8"
    },
    "npm:tile-mip-map@0.2.1": {
      "ndarray": "npm:ndarray@1.0.15",
      "ndarray-downsample2x": "npm:ndarray-downsample2x@0.1.1",
      "ndarray-ops": "npm:ndarray-ops@1.1.1"
    },
    "npm:typedarray-pool@0.1.2": {
      "bit-twiddle": "npm:bit-twiddle@0.0.2",
      "dup": "npm:dup@0.0.0"
    },
    "npm:typedarray-pool@1.1.0": {
      "bit-twiddle": "npm:bit-twiddle@1.0.2",
      "dup": "npm:dup@1.0.0"
    },
    "npm:voxel-demo@0.0.1": {
      "ao-mesher": "npm:ao-mesher@0.2.10",
      "ao-shader": "npm:ao-shader@0.2.3",
      "gl-buffer": "npm:gl-buffer@0.1.2",
      "gl-matrix": "npm:gl-matrix@2.0.0",
      "gl-now": "npm:gl-now@0.0.4",
      "gl-shader": "npm:gl-shader@0.0.6",
      "gl-tile-map": "npm:gl-tile-map@0.3.0",
      "gl-vao": "npm:gl-vao@0.0.3",
      "ndarray": "npm:ndarray@1.0.15",
      "ndarray-fill": "npm:ndarray-fill@0.1.0",
      "ndarray-ops": "npm:ndarray-ops@1.1.1"
    }
  }
});

