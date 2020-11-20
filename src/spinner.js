let spinner;
if (typeof require !== 'undefined') {
  spinner = require('ora');
}
else {
  spinner = (await import('https://deno.land/x/wait/mod.ts')).wait;
}

export default spinner;
