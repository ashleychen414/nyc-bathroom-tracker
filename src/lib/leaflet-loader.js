// Loads Leaflet (map library) from cdnjs the first time the map is opened.
// Integrity hashes pin the exact files, so a changed file is refused by the browser.

const BASE = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
const JS_SRI = 'sha512-BwHfrr4c9kmRkLw6iXFdzcdWV/PGkVgiIyIWLLlTSXzWQzxuSg4DiQUCpauz/EWjgk5TYQqX/kvn9pG1NpYfqg==';
const CSS_SRI = 'sha512-Zcn6bjR/8RZbLEpLIeOwNtzREBAJnUKESxces60Mpoj+2okopSAcSUIUOseddDm0cxnGQzxIR7vJgsLZbdLE3w==';

let loading = null;

const tag = (name, attrs) => Object.assign(document.createElement(name), { crossOrigin: 'anonymous', referrerPolicy: 'no-referrer', ...attrs });

export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  loading ??= new Promise((resolve, reject) => {
    document.head.append(tag('link', { rel: 'stylesheet', href: `${BASE}leaflet.css`, integrity: CSS_SRI }));
    const script = tag('script', { src: `${BASE}leaflet.js`, integrity: JS_SRI });
    script.onload = () => resolve(window.L);
    script.onerror = () => {
      loading = null; // allow a retry next time
      script.remove();
      reject(new Error("The map couldn't load."));
    };
    document.head.append(script);
  });
  return loading;
}
