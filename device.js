/* Presentation chrome only: fixed iOS demo time, illustrative radio and battery icons. */
(() => {
  'use strict';
  const stage = document.querySelector('.device-stage');
  const root = document.documentElement;
  function fitDevice() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    const scale = Math.min(1, (width - 32) / 421, (height - 75) / 880);
    root.style.setProperty('--device-scale', Math.max(0.1, scale).toFixed(5));
  }
  fitDevice();
  new ResizeObserver(fitDevice).observe(stage);
})();
