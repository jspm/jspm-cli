let status;
function setStatus (text) {
  status.innerHTML = text;
}

let results, curResult;
function renderTestResult (name) {
  curResult = document.createElement('li');
  curResult.innerHTML = `🚀 ${name}`;
  results.appendChild(curResult);
}
function completeTestResult (name, failure, i) {
  if (!failure) {
    curResult.innerHTML = `✔ ${name}`;
  }
  else {
    curResult.innerHTML = `❌ ${name} [${i}]: <span class="err">${failure}</span>`;
  }
}

export default async function runTests (tests) {
  status = Object.assign(document.createElement('p'), { className: 'status' });
  document.body.appendChild(status);

  results = Object.assign(document.createElement('ul'), { className: 'results' });
  document.body.appendChild(results);

  let testRange = [0, tests.length];
  window.onhashchange = () => location.reload();
  if (location.hash) {
    const exactRange = parseInt(location.hash.slice(1), 10);
    if (exactRange && exactRange.toString().length + 1 === location.hash.length) {
      testRange = [exactRange - 1, exactRange];
    }
    else {
      const range = location.hash.slice(1).split('-');
      testRange = [parseInt(range[0], 10) - 1, parseInt(range[1], 10)];
    }
  }

  let failures = 0;
  for (const [i, { test, run }] of tests.slice(...testRange).entries()) {
    setStatus(`Running test: ${i + 1}/${tests.length}${failures ? `, ${failures} failed` : ''}`);

    try {
      renderTestResult(test)
      await run();
      completeTestResult(test);
    }
    catch (err) {
      failures++;
      console.error(err);
      completeTestResult(test, err.message, i + 1);
    }
  }

  if (!failures) {
    setStatus(`All ${tests.length} tests passed.`);
  }
  else {
    setStatus(`${failures} tests failed.`);
  }
}
