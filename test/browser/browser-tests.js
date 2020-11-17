import { utils, TraceMap } from 'jspm';

(async () => {

  const inSource = `
  <!doctype html>
  <script type="importmap">
  {}
  </script>
  `;

  const scripts = utils.readHtmlScripts(inSource);
  const mapStr = inSource.slice(scripts.map[0], scripts.map[1]);
  const mapJson = JSON.parse(mapStr);

  const traceMap = new TraceMap(utils.baseUrl, mapJson);
  const opts = {
    system: false,
    clean: true
  };
  await traceMap.add('react', opts);

  const newMapStr = '\n' + traceMap.toString();
  const outSource = inSource.slice(0, scripts.map[0]) + newMapStr + inSource.slice(scripts.map[1]);
  console.log(outSource);
})();
