# Instavideo

Instavideo is a front-end-only short-form video feed (HTML/CSS/JS). It uses `localStorage` for all personalization and does not require login, backend code, cookies, or uploads.

## Project structure

- `index.html`
- `css/styles.css`
- `js/app.js`
- `videos/` (place your `.mp4` files here, referenced as `./videos/<file>.mp4`)
- `tags.txt`
- `valid_tags.txt`

## Run locally

Because the app fetches text files, use a static server:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Data files

- `valid_tags.txt`: one allowed hashtag per line (must start with `#`).
- `tags.txt`: `filename.mp4: #tag1, #tag2`.
- A video appears in feed only if:
  - it is listed in `tags.txt`,
  - has at least one valid tag,
  - and metadata can be loaded in browser,
  - and duration is `<= 120` seconds.

## Personalization state

State is stored as human-readable JSON under localStorage key `instavideo_state`.

It includes:
- `tagModel` (`a`, `b`, `w` per tag)
- `controls` (`strength`, `exploration`, `overrideEnabled`, `override`)
- `recentVideos`, `recentTagCounts`, and `history`

## Controls panel

In the feed, use the ⚙️ button to open controls:
- Personalization Strength slider
- Randomness/Exploration slider
- Manual override toggle
- Tag search + per-tag override slider
- Reset Overrides
- Randomise Overrides
- Reset Learned Profile
- Reset History
