import assert from "assert";
import { type Scenario, runScenarios } from "./scenarios";

const importMap = new Map([
  [
    "importmap.json",
    JSON.stringify({
      env: ["browser", "development", "module"],
      imports: {
        "@jspm/npm": "https://ga.jspm.io/npm:@jspm/npm@1.0.2/npm.js",
      },
      scopes: {
        "https://ga.jspm.io/": {
          buffer:
            "https://ga.jspm.io/npm:@jspm/core@2.0.1/nodelibs/browser/buffer.js",
          crypto:
            "https://ga.jspm.io/npm:@jspm/core@2.0.1/nodelibs/browser/crypto.js",
          "figgy-pudding":
            "https://ga.jspm.io/npm:figgy-pudding@3.5.2/index.js",
          fs: "https://ga.jspm.io/npm:@jspm/core@2.0.1/nodelibs/browser/fs.js",
          ini: "https://ga.jspm.io/npm:ini@1.3.8/ini.js",
          os: "https://ga.jspm.io/npm:@jspm/core@2.0.1/nodelibs/browser/os.js",
          path: "https://ga.jspm.io/npm:@jspm/core@2.0.1/nodelibs/browser/path.js",
          process:
            "https://ga.jspm.io/npm:@jspm/core@2.0.1/nodelibs/browser/process.js",
          ssri: "https://ga.jspm.io/npm:ssri@6.0.2/index.js",
          stream:
            "https://ga.jspm.io/npm:@jspm/core@2.0.1/nodelibs/browser/stream.js",
          sver: "https://ga.jspm.io/npm:sver@1.1.1/sver.js" /* downgraded */,
          url: "https://ga.jspm.io/npm:@jspm/core@2.0.1/nodelibs/browser/url.js",
          util: "https://ga.jspm.io/npm:@jspm/core@2.0.1/nodelibs/browser/util.js",
          zlib: "https://ga.jspm.io/npm:@jspm/core@2.0.1/nodelibs/browser/zlib.js",
        },
      },
    }),
  ],
]);

const scenarios: Scenario[] = [
  // Upgrading should bump the version of sver:
  {
    files: importMap,
    commands: ["jspm upgrade"],
    validationFn: async (files: Map<string, string>) => {
      assert(!files.get("importmap.json").includes("sver@1.1.1"));
    },
  },

  // Installing @jspm/github should add a separate scope with a later version
  // of sver for @jspm/github:
  {
    files: importMap,
    commands: ["jspm install @jspm/github"],
    validationFn: async (files: Map<string, string>) => {
      const sverVersions = files
        .get("importmap.json")
        .match(/sver@\d+\.\d+\.\d+/g);
      assert(sverVersions.length === 2);
      assert(sverVersions[0] !== sverVersions[1]);
      assert(
        sverVersions[0].includes("1.1.1") || sverVersions[1].includes("1.1.1")
      );
    },
  },

  // Installing @jspm/github and then upgrading should bump the version of
  // sver for both:
  {
    files: importMap,
    commands: ["jspm install @jspm/github", "jspm upgrade"],
    validationFn: async (files: Map<string, string>) => {
      assert(!files.get("importmap.json").includes("sver@1.1.1"));
    },
  },

  // Installing @jspm/github with latest enabled should bump the version of
  // sver for both:
  {
    files: importMap,
    commands: ["jspm install @jspm/github --latest"],
    validationFn: async (files: Map<string, string>) => {
      assert(!files.get("importmap.json").includes("sver@1.1.1"));
    },
  },
];

runScenarios(scenarios);
