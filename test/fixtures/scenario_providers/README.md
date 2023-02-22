# Note for maintainers:
This folder contains a `node_modules`, used to test the `nodemodules` provider
in `test/providers.test.ts`. I've stripped everything out of `node_modules`
except for the packages and javascript files required by the test. If
something breaks in the future it may work to simply `npm i lit` in here to
refresh the `node_modules` folder.
