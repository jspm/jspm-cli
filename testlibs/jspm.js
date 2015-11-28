System.config({
  packageConfigPaths: [
    "npm:@*/*.json",
    "npm:*.json",
    "github:*/*.json"
  ],
  globalEvaluationScope: false,

  map: {
    "angular": "github:angular/bower-angular@1.4.8",
    "assert": "npm:assert@1.3.0",
    "bootstrap": "github:twbs/bootstrap@3.3.6",
    "buffer": "npm:buffer@3.5.2",
    "clean-css": "npm:clean-css@3.4.8",
    "css": "github:systemjs/plugin-css@0.1.20",
    "d3": "github:mbostock/d3@3.5.9",
    "ember": "github:components/ember@1.13.2",
    "events": "npm:events@1.1.0",
    "http": "npm:stream-http@2.0.2",
    "https": "npm:https-browserify@0.0.1",
    "jquery": "github:components/jquery@2.1.4",
    "mocha": "npm:mocha@2.3.4",
    "nodelibs": "github:jspm/nodelibs@0.1.3",
    "os": "npm:os-browserify@0.1.2",
    "path": "npm:path-browserify@0.0.0",
    "punycode": "npm:punycode@1.3.2",
    "querystring": "npm:querystring@0.2.0",
    "stream": "npm:stream-browserify@2.0.1",
    "text": "github:systemjs/plugin-text@0.0.2",
    "traceur": "github:jmcriffey/bower-traceur@0.0.92",
    "traceur-runtime": "github:jmcriffey/bower-traceur-runtime@0.0.92",
    "url": "npm:url@0.11.0",
    "util": "npm:util@0.10.3",
    "vm": "npm:vm-browserify@0.0.4",
    "voxel-demo": "npm:voxel-demo@0.0.1"
  },

  packages: {
    "github:twbs/bootstrap@3.3.6": {
      "map": {
        "jquery": "github:components/jquery@2.1.4"
      }
    },
    "npm:ao-mesher@0.2.10": {
      "map": {
        "cwise-compiler": "npm:cwise-compiler@0.1.0",
        "greedy-mesher": "npm:greedy-mesher@1.0.2",
        "ndarray": "npm:ndarray@1.0.18",
        "typedarray-pool": "npm:typedarray-pool@0.1.2"
      }
    },
    "npm:ao-shader@0.2.3": {
      "map": {
        "brfs": "npm:brfs@0.0.9",
        "gl-shader": "npm:gl-shader@0.0.6"
      }
    },
    "npm:assert@1.3.0": {
      "map": {
        "util": "npm:util@0.10.3"
      }
    },
    "npm:brfs@0.0.9": {
      "map": {
        "escodegen": "npm:escodegen@0.0.17",
        "falafel": "npm:falafel@0.1.6",
        "through": "npm:through@2.2.7"
      }
    },
    "npm:buffer@3.5.2": {
      "map": {
        "base64-js": "npm:base64-js@0.0.8",
        "ieee754": "npm:ieee754@1.1.6",
        "is-array": "npm:is-array@1.0.1"
      }
    },
    "npm:clean-css@3.4.8": {
      "map": {
        "commander": "npm:commander@2.8.1",
        "source-map": "npm:source-map@0.4.4"
      }
    },
    "npm:commander@2.8.1": {
      "map": {
        "graceful-readlink": "npm:graceful-readlink@1.0.1"
      }
    },
    "npm:cwise-compiler@0.0.0": {
      "map": {
        "uniq": "npm:uniq@0.0.2"
      }
    },
    "npm:cwise-compiler@0.1.0": {
      "map": {
        "uniq": "npm:uniq@0.0.2"
      }
    },
    "npm:cwise-parser@0.0.1": {
      "map": {
        "esprima": "npm:esprima@1.0.4",
        "uniq": "npm:uniq@0.0.2"
      }
    },
    "npm:cwise@0.3.4": {
      "map": {
        "cwise-compiler": "npm:cwise-compiler@0.0.0",
        "cwise-parser": "npm:cwise-parser@0.0.1"
      }
    },
    "npm:escodegen@0.0.17": {
      "map": {
        "esprima": "npm:esprima@1.0.4",
        "estraverse": "npm:estraverse@0.0.4",
        "source-map": "npm:source-map@0.4.4"
      }
    },
    "npm:falafel@0.1.6": {
      "map": {
        "esprima": "npm:esprima@1.0.4"
      }
    },
    "npm:game-shell@0.1.4": {
      "map": {
        "domready": "npm:domready@0.2.13",
        "invert-hash": "npm:invert-hash@0.0.0",
        "iota-array": "npm:iota-array@0.0.1",
        "lower-bound": "npm:lower-bound@0.0.3",
        "uniq": "npm:uniq@0.0.2",
        "vkey": "npm:vkey@0.0.3"
      }
    },
    "npm:gl-buffer@0.1.2": {
      "map": {
        "ndarray": "npm:ndarray@1.0.18",
        "ndarray-ops": "npm:ndarray-ops@1.1.1",
        "typedarray-pool": "npm:typedarray-pool@0.1.2"
      }
    },
    "npm:gl-now@0.0.4": {
      "map": {
        "game-shell": "npm:game-shell@0.1.4",
        "webglew": "npm:webglew@0.0.0"
      }
    },
    "npm:gl-shader@0.0.6": {
      "map": {
        "glsl-exports": "npm:glsl-exports@0.0.0",
        "uniq": "npm:uniq@0.0.2"
      }
    },
    "npm:gl-texture2d@0.1.12": {
      "map": {
        "bit-twiddle": "npm:bit-twiddle@0.0.2",
        "cwise-compiler": "npm:cwise-compiler@0.1.0",
        "ndarray": "npm:ndarray@1.0.18",
        "ndarray-ops": "npm:ndarray-ops@1.1.1",
        "typedarray-pool": "npm:typedarray-pool@1.1.0",
        "webglew": "npm:webglew@0.0.0"
      }
    },
    "npm:gl-tile-map@0.3.0": {
      "map": {
        "gl-texture2d": "npm:gl-texture2d@0.1.12",
        "ndarray": "npm:ndarray@1.0.18",
        "tile-mip-map": "npm:tile-mip-map@0.2.1",
        "webglew": "npm:webglew@0.0.0"
      }
    },
    "npm:gl-vao@0.0.3": {
      "map": {
        "webglew": "npm:webglew@0.0.0"
      }
    },
    "npm:glsl-exports@0.0.0": {
      "map": {
        "glsl-parser": "npm:glsl-parser@0.0.9",
        "glsl-tokenizer": "npm:glsl-tokenizer@0.0.9",
        "through": "npm:through@2.3.8"
      }
    },
    "npm:glsl-parser@0.0.9": {
      "map": {
        "glsl-tokenizer": "npm:glsl-tokenizer@0.0.9",
        "through": "npm:through@1.1.2"
      }
    },
    "npm:glsl-tokenizer@0.0.9": {
      "map": {
        "through": "npm:through@2.3.8"
      }
    },
    "npm:greedy-mesher@1.0.2": {
      "map": {
        "iota-array": "npm:iota-array@1.0.0",
        "typedarray-pool": "npm:typedarray-pool@1.1.0",
        "uniq": "npm:uniq@1.0.1"
      }
    },
    "npm:mocha@2.3.4": {
      "map": {
        "css": "github:systemjs/plugin-css@0.1.20"
      }
    },
    "npm:ndarray-downsample2x@0.1.1": {
      "map": {
        "cwise": "npm:cwise@0.3.4",
        "ndarray-fft": "npm:ndarray-fft@0.1.0",
        "ndarray-ops": "npm:ndarray-ops@1.1.1",
        "ndarray-scratch": "npm:ndarray-scratch@0.0.1"
      }
    },
    "npm:ndarray-fft@0.1.0": {
      "map": {
        "bit-twiddle": "npm:bit-twiddle@0.0.2",
        "cwise": "npm:cwise@0.3.4",
        "ndarray": "npm:ndarray@1.0.18",
        "ndarray-ops": "npm:ndarray-ops@1.1.1",
        "typedarray-pool": "npm:typedarray-pool@0.1.2"
      }
    },
    "npm:ndarray-fill@0.1.0": {
      "map": {
        "cwise": "npm:cwise@0.3.4"
      }
    },
    "npm:ndarray-ops@1.1.1": {
      "map": {
        "cwise-compiler": "npm:cwise-compiler@0.0.0"
      }
    },
    "npm:ndarray-scratch@0.0.1": {
      "map": {
        "ndarray": "npm:ndarray@1.0.18",
        "typedarray-pool": "npm:typedarray-pool@0.1.2"
      }
    },
    "npm:ndarray@1.0.18": {
      "map": {
        "iota-array": "npm:iota-array@1.0.0",
        "is-buffer": "npm:is-buffer@1.1.0"
      }
    },
    "npm:readable-stream@2.0.4": {
      "map": {
        "core-util-is": "npm:core-util-is@1.0.2",
        "inherits": "npm:inherits@2.0.1",
        "isarray": "npm:isarray@0.0.1",
        "process-nextick-args": "npm:process-nextick-args@1.0.3",
        "string_decoder": "npm:string_decoder@0.10.31",
        "util-deprecate": "npm:util-deprecate@1.0.2"
      }
    },
    "npm:source-map@0.4.4": {
      "map": {
        "amdefine": "npm:amdefine@1.0.0"
      }
    },
    "npm:stream-browserify@2.0.1": {
      "map": {
        "inherits": "npm:inherits@2.0.1",
        "readable-stream": "npm:readable-stream@2.0.4"
      }
    },
    "npm:stream-http@2.0.2": {
      "map": {
        "builtin-status-codes": "npm:builtin-status-codes@1.0.0",
        "inherits": "npm:inherits@2.0.1",
        "xtend": "npm:xtend@4.0.1"
      }
    },
    "npm:tile-mip-map@0.2.1": {
      "map": {
        "ndarray": "npm:ndarray@1.0.18",
        "ndarray-downsample2x": "npm:ndarray-downsample2x@0.1.1",
        "ndarray-ops": "npm:ndarray-ops@1.1.1"
      }
    },
    "npm:typedarray-pool@0.1.2": {
      "map": {
        "bit-twiddle": "npm:bit-twiddle@0.0.2",
        "dup": "npm:dup@0.0.0"
      }
    },
    "npm:typedarray-pool@1.1.0": {
      "map": {
        "bit-twiddle": "npm:bit-twiddle@1.0.2",
        "dup": "npm:dup@1.0.0"
      }
    },
    "npm:url@0.11.0": {
      "map": {
        "punycode": "npm:punycode@1.3.2",
        "querystring": "npm:querystring@0.2.0"
      }
    },
    "npm:util@0.10.3": {
      "map": {
        "inherits": "npm:inherits@2.0.1"
      }
    },
    "npm:vm-browserify@0.0.4": {
      "map": {
        "indexof": "npm:indexof@0.0.1"
      }
    },
    "npm:voxel-demo@0.0.1": {
      "map": {
        "ao-mesher": "npm:ao-mesher@0.2.10",
        "ao-shader": "npm:ao-shader@0.2.3",
        "gl-buffer": "npm:gl-buffer@0.1.2",
        "gl-matrix": "npm:gl-matrix@2.0.0",
        "gl-now": "npm:gl-now@0.0.4",
        "gl-shader": "npm:gl-shader@0.0.6",
        "gl-tile-map": "npm:gl-tile-map@0.3.0",
        "gl-vao": "npm:gl-vao@0.0.3",
        "ndarray": "npm:ndarray@1.0.18",
        "ndarray-fill": "npm:ndarray-fill@0.1.0",
        "ndarray-ops": "npm:ndarray-ops@1.1.1"
      }
    }
  }
});