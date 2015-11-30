#!/bin/bash

gitbook build

cd ..
git add docs/_book --all --force
git commit -m 'GH-PAGES UPDATE' -a
git subtree split --prefix docs/_book -b gh-pages
git push -f origin gh-pages:gh-pages
git branch -D gh-pages
