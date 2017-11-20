cp -r registries/npm node_modules/jspm-npm
cp -r registries/github node_modules/jspm-github
cd sandbox/node_modules
node -e "fs.symlinkSync('../..', 'jspm', 'junction')"
cd ..
cd ..

