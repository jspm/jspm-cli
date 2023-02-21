import assert from "assert";
import uninstall from "../src/uninstall";

{
  /* basic uninstall */
  const map = await uninstall(["react"], {
    silent: true,
    stdout: true,
    map: "test/fixtures/importmap.json",
  });
  assert.ok(typeof map.imports?.react);
}
