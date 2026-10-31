import { Game } from './Game.js';

/**
 * Entry point. Boots the game and surfaces any startup failure on screen —
 * a blank canvas with the error only in the console is exactly the debugging
 * experience this project spent long enough suffering through already.
 */
const canvas = document.getElementById('view');
const hud = document.getElementById('hud');

new Game(canvas, hud)
  .init()
  .then((game) => {
    // Handy for poking at state from the console during development.
    window.game = game;
  })
  .catch((err) => {
    console.error(err);
    document.getElementById('boot').innerHTML = `
      <div class="err">
        <h1>Failed to start</h1>
        <p>${err.message}</p>
        <p class="hint">Serve this folder over HTTP — <code>cd web &amp;&amp; go run .</code></p>
      </div>`;
    document.getElementById('boot').classList.add('show');
  });
