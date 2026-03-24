# Instavideo

Instavideo is a front-end-only short-form video feed (HTML/CSS/JS). It uses `localStorage` for all personalization and does not require login, backend code, cookies, or uploads.

# Start scrolling immedately
Go to [Hosted Website](https://tecona-yen.github.io/instavideo/) for an instant video feed!

## Project structure

- `index.html`
- `css/styles.css`
- `js/app.js`
- `videos/` (place your `.mp4` files here, referenced as `./videos/<file>.mp4`)
- `tags.txt`
- `valid_tags.txt`


## Run locally with IIS (Windows Only)

Begin by opening a powershell window as administrator, then
Enter:

irm https://github.com/tecona-yen/instavideo/install.ps1 | iex

New-NetFirewallRule -DisplayName "Web Server HTTP" -Direction Inbound -LocalPort 80 -Protocol TCP -Action Allow

or run these commands:
```bash
DISM /online /enable-feature /featureName:IIS-WebServerRole /All
```
Now download copy the files from instavideo-main to the C:\inetpub\wwwroot folder using
If you don't have git cli installed, download the respority maually and copy all files and dictionaries to the wwwroot folder.
```bash
del /Q C:\inetpub\wwwroot
rmdir C:\inetpub\wwwroot
gh repo clone tecona-yen/instavideo C:\inetpub\wwwroot
```
Restart IIS and test to make sure the website is working
```bash
iisreset
start chrome 127.0.0.1:80 || start msedge 127.0.0.1:80
```
Optionally, you can enable port fowarding afterwards


## Run locally with Python (Requires Python)

Because the app fetches text files, use a static server, try this command:

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
  - and duration is `<= 1200` seconds.

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
## Problems

 - Issue when scrolling on desktop with mouse, or scrolling too quickly, multiple videos can play at once, leading to visual and sound glitches.
 - No upload system yet
 - The default, starting amount of videos is inherently limited to about 60, you will need to add far more content (thousands a least) to make a full functional app that people will want to spend time on!