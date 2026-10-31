# Refrain — pencil cursor

Hand-drawn, monochrome pencil cursor (transparent background) for the Refrain personal music journal.

## Assets

- `refrain-pencil-48.png` — recommended desktop/web asset; use hotspot **7 43**.
- `refrain-pencil-32.png` — compact alternate; use hotspot **5 28**.
- `refrain-pencil-64.png` — larger alternate; use hotspot **9 57**.
- `refrain-pencil.svg` — editable vector master, 64×64 viewBox; point at ~9,56.
- `refrain-pencil.cur` — Windows cursor, 32×32, hotspot **5 28**.
- `preview.png` — visual preview, includes a real-size 48px version.

## CSS

Copy `refrain-pencil-48.png` to `public/cursors/refrain-pencil-48.png`.

```css
/* Desktop mouse / trackpad only */
@media (hover: hover) and (pointer: fine) {
  html, body {
    cursor: url('/cursors/refrain-pencil-48.png') 7 43, auto;
  }

  /* Keep interactive and editing states clear */
  a, button, select, [role='button'] { cursor: pointer; }
  input, textarea, [contenteditable='true'] { cursor: text; }
}
```

Coordinates are pixels from the top-left corner of the PNG. The tip, not the eraser, is the pointer location. For PNG hotspot compatibility, standard mouse cursors remain as fallbacks.
