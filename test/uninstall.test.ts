import assert from "assert";
import uninstall from "../src/uninstall";

{
  /* basic uninstall */
  const map = await uninstall(
    ["react"],
    {
      stdout: true,
      map: "test/importmap.json",
    },
    true
  );
  assert.ok(typeof map.imports?.react);
}
