# T-Rex Dino for PewPlay

This directory contains the original static game adapted for the PewPlay game template. Open `index.html` to play.

`game.json` holds the game page text. `preview.png` and `cover.png` provide the page images. The PewPlay workflow checks pushes to `preview` and `main`. The game remains a draft until you remove `"draft": true` after reviewing it.

Game controls: Jump over approaching obstacles and survive for as long as possible.

## Second pass (October 2026)

- The single 117 KB page (Chromium error-page markup and CSS, base64 sprites and sounds) was split into `index.html`, `style.css`, `game.js` and the sprite sheets in `assets/`.
- Same game rules and numbers as before, but the play strip now fills the whole window at any size and orientation (its width adapts to the screen shape), with crisp pixel art on high-DPI screens.
- Pointer controls: tap/click to jump, hold for a higher jump, swipe down to drop faster, tap to restart. Pause on hidden tab (P/Esc), synthesized sounds with a mute button (M).
- Best score saved in `dino:best` (the previous version did not save it). New cover and screenshots.
