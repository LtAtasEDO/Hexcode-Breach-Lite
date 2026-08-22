# Hexcode-Breach-Lite
A lightweight Cyberpunk-style hexcode breach minigame for Foundry VTT v12 and Cyberpunk RED v0.92.1. Create scene-local puzzle libraries, strict Netrunner role access, customizable grid and buffers, repeatable hexcodes, audited emergency resets, and custom rewards.

Module assisted with AI. Legacy Proof of concept Macro found at Cyberpunk Red Foundry VTT shared content discord. 

## Stable release: v1.0.4

Originally released stable on **2026-08-02** after successful live testing with separate Gamemaster and player accounts. **v1.0.4 (2026-08-14)** is the current icon-path hotfix. It keeps the validated v1.0.3 Monk's Active Tile Triggers helper behavior and replaces the nonexistent circuit icon with the Cyberpunk RED computer icon; no puzzle-data migration is required.

### Core features

- Scene-local breach puzzle libraries and Tile bindings.
- Strict Netrunner-only live access using the Netrunner Role or Interface Role Ability.
- Explicit **Save + GM Preview** bypass for Gamemaster testing only.
- Custom / Current grids from **4×4 through 8×8**.
- Custom buffers from **4 through 14**.
- Editable named templates.
- Repeatable hexcodes inside ordered sequences.
- Timer begins on the first valid hexcode selection.
- A single cracked sequence counts as a successful breach.
- One-use Emergency Reset that clears the current buffer, rebuilds the matrix, halves remaining time, and records the reset in chat.
- Eurobuck, Item, and RollTable data rewards.
- Drag-and-drop and searchable Item / RollTable selection.
- Player-visible reward names before the breach is completed.
- Verified puzzle, sequence, and stale Tile-binding deletion.
- Public chat progress and final breach results.
- No audio assets or required compendium packs.

## Compatibility

- Foundry Virtual Tabletop: **v12.343**
- Cyberpunk RED system: **v0.92.1**
- Monk's Active Tiles: supported through the generated helper Macro and scene-bound Tile flags.

## API

```js
game.modules.get("hexcode-breach-lite").api.openGM();
await game.modules.get("hexcode-breach-lite").api.openPuzzle("PUZZLE_ID");
await game.modules.get("hexcode-breach-lite").api.openBound(typeof args === "undefined" ? null : args);
```

`openPuzzle` is a live entry point and requires a verified Netrunner Actor. Use **Save + GM Preview** in the GM editor for role-bypassed testing.

## Install

Place the module contents directly in:

```text
FoundryVTT/Data/modules/hexcode-breach-lite/
```

The `module.json`, `scripts`, `styles`, and `templates` entries must all be directly inside that folder.

## Monk's Active Tiles helper

Use the GM window's **Create Helper Macro** button, then execute that Macro from the bound Tile. The generated Script Macro is intentionally patterned after the working Vendit-style helper and calls the module API directly instead of depending on the `game.hexcodebreach` compatibility alias:

```js
const hbl = game.modules.get("hexcode-breach-lite")?.api;
if (!hbl) return ui.notifications.error("Hexcode Breach Lite API is not available. Confirm the module is enabled, then restart Foundry.");
return hbl.openBound({
  args: typeof args === "undefined" ? null : args,
  tile: typeof tile === "undefined" ? null : tile,
  token: typeof token === "undefined" ? null : token,
  actor: typeof actor === "undefined" ? null : actor
});
```

Select the Tile with Foundry Tile Controls and press **Bind Selected Tile** in the GM window. The binding stores both the active Scene ID and breach puzzle ID on the Tile. Monk's Active Tile Triggers v12 supplies the triggering Tile, Token, Actor, and action arguments to Script Macros. The helper forwards those values directly to `module.api.openBound()` so no puzzle ID needs to be hard-coded. Leave the Monk's argument field blank for Tile-bound puzzles.

If a helper Macro from v1.0.1 or v1.0.2 was manually edited and Foundry reports a Macro Joint Validation error, delete that helper Macro and use **Create Helper Macro** once to create a clean v1.0.3 copy.

## Storage model

The module does not require a compendium pack. Saved puzzles are stored in Scene flags, and Tile bindings are stored on the bound Tile. Each breach therefore remains specific to its Scene.
