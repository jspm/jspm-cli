import assert from "assert";
import { spyOn } from "tinyspy";
import install from "../src/install";
import { parsePackageSpec, wrapCommand } from "../src/utils";

{
  let errorStr = "";
  spyOn(console, "error", (err) => {
    errorStr = err;
  });
  /* basic install 404 with wrapCommandAndRemoveStack should not throw with stack mesage */
  await wrapCommand(install)(["package-does-not-exist"], {
    env: "development",
    stdout: true,
    map: "test/fixtures/importmap.json",
  });
  assert.ok(process.exitCode === 1);
  assert.ok(
    errorStr.includes(
      "Unable to resolve npm:package-does-not-exist@ to a valid version imported from"
    )
  );
  process.exitCode = 0;
}

{
  // Check that we can parse (a subset of) package specifiers correctly:
  const testCases = [
    { input: "npm", output: "npm" },
    { input: "@npmcli/arborist", output: "@npmcli/arborist" },
    { input: "@npmcli/arborist@latest", output: "@npmcli/arborist" },
    { input: "npm@6.13.1", output: "npm" },
    { input: "npm@^4.0.0", output: "npm" },
  ];

  for (const { input, output } of testCases) {
    assert.strictEqual(parsePackageSpec(input), output);
  }
}
