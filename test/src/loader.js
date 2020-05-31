export function createMapLoader (importMap, system) {
  const iframe = Object.assign(document.createElement('iframe'), {
    src: './src/loader.html',
    style: 'display: none'
  });
  const loadPromise = new Promise(resolve => {
    iframe.onload = () => resolve(iframe.contentWindow.injectAndRunImportMap(importMap, system));
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
