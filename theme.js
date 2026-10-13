/* The workspace setting is authoritative. This small cache prevents a bright
   startup flash while IndexedDB is opening; blocked localStorage is harmless. */
(() => {
  'use strict';
  const logos = {
    light: 'assets/logo浅色.png',
    dark: 'assets/logo深色.png'
  };
  const cacheKey = 'visense-appearance';
  let current = 'light';
  try {
    if (localStorage.getItem(cacheKey) === 'dark') current = 'dark';
  } catch (_) { /* The app can still persist its setting in IndexedDB. */ }

  function updateElements() {
    const path = logos[current];
    document.querySelectorAll('img[data-theme-logo]').forEach(image => {
      if (image.getAttribute('src') !== path) image.src = path;
    });
    document.querySelectorAll('link[rel="icon"],link[rel="apple-touch-icon"]').forEach(link => {
      if (link.getAttribute('href') !== path) link.href = path;
    });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = current === 'dark' ? '#151815' : '#f8f5e9';
  }

  function apply(mode, persistCache = true) {
    current = mode === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = current;
    document.documentElement.style.colorScheme = current;
    updateElements();
    if (persistCache) {
      try { localStorage.setItem(cacheKey, current); } catch (_) { /* Optional cache only. */ }
    }
  }

  window.VisenseTheme = {
    apply,
    logo: mode => logos[mode === 'dark' ? 'dark' : 'light'],
    current: () => current
  };
  apply(current, false);
  document.addEventListener('DOMContentLoaded', updateElements, { once: true });
})();
