// ┌─────────────────────────────────┐ \\
// │ Copyright © 2026 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

// Dev rig for the query execution tree (`/qet.html`, dev server only).
//
// It renders the QET view against a simulated query execution, so the tree can
// be worked on without a backend, without an endpoint and — most importantly —
// without waiting for the Monaco editor and the language server to load.

import '../../style.css';
import { setupQetView } from '../init';
import { clearQueryExecutionTree } from '../tree';
import { DEFAULT_PLAN } from './plan';
import { Simulation } from './simulate';

const FRAME_INTERVAL_MS = 50;

// NOTE: the modal markup is lifted out of index.html at runtime instead of
// being duplicated here, so the rig can never drift from the real page.
async function mountModalMarkup() {
  const html = await fetch('index.html').then((response) => response.text());
  const modal = new DOMParser()
    .parseFromString(html, 'text/html')
    .getElementById('queryExecutionTreeModal');
  if (!modal) throw new Error('index.html has no #queryExecutionTreeModal');
  document.body.appendChild(modal);
}

mountModalMarkup().then(() => {
  const { openModal, renderTree } = setupQetView();
  openModal();

  const simulation = new Simulation(DEFAULT_PLAN);
  const slider = document.getElementById('devTimeline') as HTMLInputElement;
  const playButton = document.getElementById('devPlayButton')!;
  const restartButton = document.getElementById('devRestartButton')!;
  const speedSelect = document.getElementById('devSpeed') as HTMLSelectElement;
  const clock = document.getElementById('devClock')!;

  slider.max = String(Math.ceil(simulation.duration));

  let time = 0;
  let playing = false;
  let lastTick = 0;

  function draw() {
    renderTree(simulation.frameAt(time));
    slider.value = String(time);
    clock.textContent = `${(time / 1000).toFixed(2)}s / ${(simulation.duration / 1000).toFixed(2)}s`;
  }

  function tick(now: number) {
    if (!playing) return;
    const delta = (now - lastTick) * Number(speedSelect.value);
    lastTick = now;
    time = Math.min(time + delta, simulation.duration);
    draw();
    if (time >= simulation.duration) {
      pause();
      return;
    }
    setTimeout(() => requestAnimationFrame(tick), FRAME_INTERVAL_MS);
  }

  function play() {
    if (time >= simulation.duration) time = 0;
    playing = true;
    playButton.textContent = 'Pause';
    lastTick = performance.now();
    requestAnimationFrame(tick);
  }

  function pause() {
    playing = false;
    playButton.textContent = 'Play';
  }

  function restart() {
    pause();
    // NOTE: the view keeps the rendered tree as state; drop it so the restart
    // rebuilds the layout exactly like a fresh query does.
    clearQueryExecutionTree();
    time = 0;
    draw();
    play();
  }

  playButton.addEventListener('click', () => (playing ? pause() : play()));
  restartButton.addEventListener('click', restart);
  document.getElementById('rerunQueryButton')!.addEventListener('click', restart);
  slider.addEventListener('input', () => {
    pause();
    time = Number(slider.value);
    draw();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === ' ') {
      event.preventDefault();
      playing ? pause() : play();
    }
  });

  draw();
  play();
});
