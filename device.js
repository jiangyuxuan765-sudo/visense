/* Presentation chrome only: live local clock, illustrative radio and battery icons. */
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
  function updateClock() {
    const now = new Date();
    const time = document.getElementById('ios-time');
    time.textContent = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    time.dateTime = now.toISOString();
  }
  fitDevice();
  updateClock();
  new ResizeObserver(fitDevice).observe(stage);
  setInterval(updateClock, 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateClock();
  });
})();
