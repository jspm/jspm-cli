export function createMapLoader (importMap) {
  const iframe = Object.assign(document.createElement('iframe'), {
    src: './src/loader.html',
    style: 'display: none'
  });
  const loadPromise = new Promise(resolve => {
    iframe.onload = () => resolve(iframe.contentWindow.injectAndRunImportMap(importMap));
  });
  document.body.appendChild(iframe);
  return {
    async import (specifier) {
      const importFn = await loadPromise;
      return importFn(specifier);
    },
    dispose () {
      document.body.removeChild(iframe);
    }
  };
}
