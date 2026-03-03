# Instavideo

Instavideo is a front-end-only short-form video feed that personalizes rankings entirely in the browser using `localStorage`.

## Project structure

- `index.html`
- `css/styles.css`
- `js/app.js`
- `videos/` (place your `.mp4` files here)
- `tags.txt`
- `valid_tags.txt`

## Local run

Because the app reads `tags.txt` and `valid_tags.txt` through `fetch`, run it with a local HTTP server (not direct `file://`).

### Option A (Python)

```bash
python3 -m http.server 8000
```

Then open: `http://localhost:8000`

## Notes

- Videos are discovered from `tags.txt` entries and loaded from `/videos/<filename>.mp4`.
- Invalid tag lines and unknown tags are ignored.
- Personalization can be reset using the **Reset personalization** button.
