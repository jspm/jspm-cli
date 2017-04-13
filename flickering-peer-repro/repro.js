const jspm = require("../api.js");
const globalConfig = require("../lib/config/global-config");
const rimraf = require("rimraf");
const registry = require("test-registry");

const testRegistryConfig = globalConfig.config.registries.testing || {};
globalConfig.config.registries.testing = testRegistryConfig;
testRegistryConfig.handler = "test-registry";

rimraf.sync("package.json");
rimraf.sync("jspm.config.js");
rimraf.sync("jspm_packages");

registry.testPackages["package-a"].lookupDelay = 0;
registry.testPackages["package-b"].lookupDelay = 100;

jspm.install("main", "testing:main@^1.0.0", {force: true});
