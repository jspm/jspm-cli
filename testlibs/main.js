import mocha from 'mocha';
import * as suites from 'tests/tests';

mocha.setup('tdd');
for (var s in suites) {
  suite(s, function() {
    this.timeout(10000);
    setup(function() {
      document.querySelector("#sandbox").innerHTML = '';
    });
    for (var t in suites[s])
      test(t, suites[s][t]);
  });
}
mocha.run();