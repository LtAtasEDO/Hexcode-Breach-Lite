# Changelog

## 1.0.4 — 2026-08-14

Helper Macro icon path hotfix.

- Replaced the nonexistent `icons/svg/circuit.svg` helper Macro image with `systems/cyberpunk-red-core/icons/compendium/gear/computer.svg`.
- The GM **Create Helper Macro** button now displays the same Cyberpunk RED computer icon for consistency.
- Pressing **Create Helper Macro** also updates the image on an existing helper Macro, so no Macro deletion is required.
- No puzzle-data or Tile-binding migration is required.

## 1.0.3 — 2026-08-11

Stable Monk's Active Tile Triggers helper compatibility repair.

- The generated helper no longer depends on the `game.hexcodebreach` compatibility alias.
- The helper now calls `game.modules.get("hexcode-breach-lite").api.openBound(...)` directly, matching the proven helper pattern used by the user's other Foundry modules.
- The helper forwards Monk's `tile`, `token`, `actor`, and `args` values and does not use top-level `await`.
- Retains `game.hexcodebreach` only as a backwards-compatibility alias.
- If an older helper Macro is already malformed, delete it once and recreate it from the GM Config window.
- No puzzle-data or Tile-binding migration is required.

## 1.0.2 — 2026-08-11

Stable Monk's Active Tile Triggers v12 helper repair.

- Replaced the generated multiline helper with a validator-safe one-line Script Macro.
- Uses Monk's v12 named Macro scope (`tile`, `token`, `actor`, `args`) instead of treating `args` as the trigger context.
- Added an API-ready guard and a clear warning when the helper is run outside Monk's Active Tile Triggers.
- Exposes `module.api`, `window.HexcodeBreachLite`, and `game.hexcodebreach` during both `init` and `ready` to avoid startup-order gaps.
- Removed automatic opening of the helper Macro sheet after creation/update.
- Added repair error handling for an already-corrupted helper Macro.
- No puzzle-data or Tile-binding migration is required from v1.0.0/v1.0.1.

## 1.0.1 — 2026-08-09

Stable hotfix for Monk's Active Tile Triggers integration.

- Fixed the generated helper Macro failing with `Hexcode Breach could not identify the triggering tile.`
- The helper now forwards Monk's `tile` context directly, alongside `args`, `token`, and `actor` when available.
- Made triggering-Tile resolution recursive so nested Monk's payload/context shapes can still resolve the bound Tile.
- Preserved scene-local binding and Netrunner-only live access.
- No puzzle-data migration is required from v1.0.0.

## 1.0.0 — 2026-08-02

First stable release.

- Promoted after successful separate Gamemaster and player-account testing.
- Supports custom 4×4–8×8 matrices and 4–14-slot buffers.
- Includes scene-local puzzle libraries and Tile bindings.
- Enforces Netrunner-only live entry with a GM Preview exception.
- Supports ordered sequences with repeated hexcodes.
- Includes one audited Emergency Reset that halves remaining time.
- Supports Eurobuck, Item, and RollTable rewards with player-visible payload names.
- Includes reliable puzzle, sequence, and stale binding deletion.

## 0.4.0-beta.1 — 2026-08-02

- First beta build.
- Added configurable 4×4–8×8 grids and 4–14 buffers.

## 0.3.4

- Corrected puzzle, sequence, and Tile-binding deletion.
- Added player-visible reward names.

## 0.3.3

- Enforced Netrunner access on all live entry points.
- Reserved role bypass for Save + GM Preview.
- Improved loaded reward visibility.

## 0.3.2

- Restored repeated hexcodes in sequences.

## 0.3.1

- Made sequence controls the source of the derived Hex Pool.

## 0.3.0

- Added clickable Hex Pool controls, scene puzzle library, reward browsers, Netrunner role checks, and Emergency Reset tracking.

## 0.2.x

- Added editable templates, timer-on-first-hex behavior, one-sequence success, Eurobuck rewards, RollTable data, and scene-bound Tile support.

## 0.1.x

- Initial Foundry-native proof of concept.
