# 761 climate

A small phone app for the heating and cooling: pick a room's temperature and it works out the rest (heating or cooling for that floor, the ceiling panels, the fan coils).

- `src/` the app (one page, English and Japanese), the shared control logic (`core.js`) and the room map (`rooms.json`).
- `supervisor/` the background check that runs every 5 minutes on GitHub Actions with the same logic.
- `docs/` the published pages, encrypted (shared page and an admin page, each with its own password).
- `build.sh` builds, encrypts and publishes. `node test/unit.js` tests the logic; `node test/shoot.js` takes iPhone screenshots against a mock.
