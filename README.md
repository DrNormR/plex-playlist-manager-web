# Plex Manager

A web app for managing **lots** of Plex playlists, collections and metadata, across several accounts, without
fighting the Plex UI. It replaces the old WinForms
[plex-playlist-manager](https://github.com/DrNormR/plex-playlist-manager).

## What it does

**Accounts**
- Sign in with Plex (the normal plex.tv sign-in page), or paste a token.
- Add your **Plex Home** users (family profiles) from the admin account. A PIN is asked once if the profile has one, and it isn't stored.
- Switch accounts from the top bar. Each account sees and edits its own playlists.

**Library**
- Browse any library as a list or a poster grid, 100 titles at a time as you scroll.
- Filter by title, genre, year range, or unwatched, or jump to a starting letter. Sort by title, year, date added, release date, rating, or last watched.
- **Not in any playlist** shows only titles you haven't put in a playlist yet.
- Drill into shows → seasons → episodes, and artists → albums → tracks.
- Click a title to see its details, and tick or untick playlists (any account) and collections (admin) in the side panel.
- Tick several titles to add them anywhere at once, or pick a **Quick add** playlist and use the **+** button on each title.
- **Add to playlists** lets you tick any number of playlists (or collections), plus a new one, and adds to all of them in one go.
- **For shows add:** when you add a show or season to a playlist, choose **First episode** (the default), **Next unwatched episode** (using that account's watch history), or **All episodes**. Specials (season 0) are skipped. The choice is remembered.
- **Mark watched / unwatched** for one title (side panel) or many (tick them first), for the current account. Shows and seasons mark all their episodes.

**Edit, match & info** (Edit…, Match… and Info buttons in the title panel)
- **General:** title, sort title, original title, edition, release date, year, content rating, studio, tagline, and summary. The fields shown depend on the type (movie, show, season, episode, artist, album, track).
- **Tags:** genres, labels, collections, directors, writers, producers, countries, styles, and moods, as chips with suggestions from the library. Typing a new collection name creates that collection.
- Every field has a 🔒 lock like in Plex. Editing a field locks it, so a metadata refresh won't overwrite your change.
- **Match:** search for a match and apply it (Fix Match), unmatch, or refresh metadata. The search starts with the title and year read from the **file name** (or the folder name for shows), e.g. `The.Crucible.1996.1080p.BluRay.x264.mkv` → *The Crucible*, 1996. One click switches back to the current Plex title.
- **Info:** file paths (with a Copy button), resolution, codecs, bitrate, size, streams, external IDs, and dates. Any account can see Info; editing and matching need the server admin account.

**Dates from file names** (sports libraries; 📅 button in the Library toolbar, admin account)
- Reads the date in names like `MLB - 2025-11-01 - Dodgers at Blue Jays (World Series Game 7).mp4` (full date) or
  `Super Bowl 56 - 2022 - Rams vs. Bengals.mp4` (year only) and sets each title's **year** and **release date**. If the file name has no date, its folder name is tried.
  It also understands `2024.01.15`, `2024_01_15` and `01-15-2024`.
- Shows a preview of what would change (now → new). Untick any rows you want to skip, then update them all at once.
- Year-only names can set the release date to Jan 1 of that year (an exact date already in that year is kept), or set the year only.
- Optionally also set the title to the file name.
- Works on movie libraries (each movie) and TV libraries (each episode). Changed fields are locked so a Plex refresh won't undo them.
- **Automatic:** tick it for a library and titles added from then on are updated every 30 minutes (`AUTO_DATES_MINUTES` changes that), with **Check now** to run it right away.

**Artwork**
- Change a poster/thumbnail or background art for titles, playlists, and collections.
- Upload a file (choose or drag-and-drop JPEG, PNG or WebP, up to 20 MB), paste an image URL, or pick one of the alternatives Plex already has.
- **Search the web** right in the artwork window. The search box starts with the title; click an image to preview it, then **Use as poster/background**. Poster-shaped (or wide, for backgrounds) images are listed first.
  This uses Google Images through [SerpApi](https://serpapi.com/): paste your API key on the Accounts page (the free plan has 250 searches a month, and repeat searches within a day are cached). Without a key, **Open in Google Images** opens the search in a new tab.
- Changing a title's or collection's artwork needs the server admin account.

**Playlists**
- Filter, sort, and bulk-select playlists. Bulk **delete**, or bulk **copy to another account** (in the same order).
- **Copy between profiles** (e.g. robertlnorman ↔ Family): as a new playlist, or **into an existing playlist** on the other profile, skipping titles already there. It warns if the other profile can't see some titles (libraries not shared with it).
- Mark selected items watched or unwatched.
- Drag-and-drop reorder with **multi-select** (Ctrl/Shift-click, then drag the group).
- Move selected items to the top, up, down, to the bottom, or to a numbered position.
- Sort the whole list, or only the selected rows: title, year, release date, show → season → episode, date added, length, unwatched first, reverse, shuffle.
- Remove selected items, remove duplicates, or remove watched items.
- Add titles by searching your libraries. Copy selected items to another playlist or collection, for any account.
- Rename, duplicate, or delete a playlist.
- **Edits are staged**: nothing changes in Plex until you click **Save**. Undo (Ctrl+Z), Discard, and "restore" for removed items all work before you save. Saving uses the fewest Plex "move" calls needed.

**Collections** (admin account)
- The same editor for collections in any library. Saving a new order switches the collection to custom sort.
- Add, remove, rename, delete, and bulk delete.

**Search**
- Search all libraries. Click a result to see **every playlist it's in**, and tick or untick to add or remove it.
  This works for whole shows and seasons too, matched by their episodes. You can check another account's playlists from the same panel.
- Tick several results to add them all to a playlist or collection at once, or to create a new one.

Keyboard shortcuts in a list: `Delete` removes the selected items, `Alt+↑/↓` moves them, `Ctrl+A` selects all, `Ctrl+Z` undoes.

## Run it on the server (Docker)

```bash
git clone <this repo> /opt/plex-playlist-manager && cd /opt/plex-playlist-manager
echo "APP_PASSWORD=choose-a-password" > .env
# optional: echo "PLEX_URL=http://192.168.0.158:32400" >> .env
docker compose up -d --build
```

Then open `http://<server>:8085`, log in with the app password, and on **Accounts**:
1. Check the Plex server address. It is read from `PLEX_URL` when that is set.
2. Click **Sign in with Plex** and sign in with your admin account.
3. Click **Home users…** next to it and add the family profiles.

Accounts and tokens are saved in `./data/config.json` (file mode 600). Back up that folder, and keep it private.

## Develop

```bash
npm install
npm run dev        # API on :8080, UI with hot reload on http://localhost:5173
npm test           # reorder, metadata and file-name parsing tests
npm run typecheck
npm run build && npm start   # production build on :8080
```

Environment variables: `PLEX_URL`, `APP_PASSWORD`, `PORT` (default 8080), `DATA_DIR` (default `./data`), optionally `SERPAPI_KEY` (instead of entering it on the Accounts page), and `AUTO_DATES_MINUTES` (default 30).

## Notes

- Plex playlists belong to an account. Collections belong to the library, so only the server admin can edit them.
- Smart playlists and smart collections are read-only here, because Plex builds them from rules. You can still copy items out of them.
- The app talks to Plex from the server, so tokens never reach the browser. Artwork is proxied for the same reason.
