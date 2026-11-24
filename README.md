# Plex Playlist Manager (web)

A web app for managing **lots** of Plex playlists and collections, across several accounts, without
fighting the Plex UI. It replaces the old WinForms
[plex-playlist-manager](https://github.com/DrNormR/plex-playlist-manager).

## What it does

**Accounts**
- Sign in with Plex (the normal plex.tv sign-in page), or paste a token.
- Add your **Plex Home** users (family profiles) from the admin account. A PIN is asked once if the profile has one, and it isn't stored.
- Switch accounts from the top bar. Each account sees and edits its own playlists.

**Playlists**
- Filter, sort, and bulk-select playlists. Bulk **delete**, or bulk **copy to another account** (in the same order).
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
npm test           # reorder algorithm tests
npm run typecheck
npm run build && npm start   # production build on :8080
```

Environment variables: `PLEX_URL`, `APP_PASSWORD`, `PORT` (default 8080), and `DATA_DIR` (default `./data`).

## Notes

- Plex playlists belong to an account. Collections belong to the library, so only the server admin can edit them.
- Smart playlists and smart collections are read-only here, because Plex builds them from rules. You can still copy items out of them.
- The app talks to Plex from the server, so tokens never reach the browser. Artwork is proxied for the same reason.
