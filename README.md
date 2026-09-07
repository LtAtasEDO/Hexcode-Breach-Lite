# Hexcode-Breach-Lite

A lightweight Cyberpunk-style breach-protocol minigame for **Foundry VTT v12** and the **Cyberpunk RED Core** system.

Hexcode Breach Lite lets a GM build reusable breach puzzles, bind them to Tiles, restrict live access to Netrunners, and attach Eurobuck, Item, or RollTable rewards to individual sequences.

> **v1.2.0 release candidate:** keeps the v1.1.0 Portable (World), one-time reward, socket-delivery, and close-hook contracts, while adding CP2077-style overlapping sequence resolution and buffer-aware fresh attempt matrices. The configured buffer remains a real hard capacity.

## Requirements

- Foundry Virtual Tabletop **v12.343**
- Cyberpunk RED Core **v0.92.1+** (verified through **v0.92.4**)
- **Recommended:** Monk's Active Tile Triggers for click-to-open Tile automation

No compendium packs or audio assets are required.

## Quick Start

1. Enable **Hexcode Breach Lite** in your Cyberpunk RED world.
2. As GM, open **Token Controls → Hexcode Breach Lite**.
3. Create or load a breach, configure its grid, buffer, timer, sequences, and rewards.
4. Choose a **Storage Scope**:
   - **Scene-local** — fixed to the active Scene.
   - **Portable (World)** — available from any Scene.
5. Press **Save Puzzle**.
6. Select the Tile that represents the terminal/device and press **Bind Selected Tile**.
7. Press **Create Helper Macro** once, then add that Macro to a Monk's **Run Macro** Tile action. Leave Monk's Arguments blank.
8. Trigger the Tile with a Netrunner Actor.

The generated helper Macro is universal. You do **not** hard-code a puzzle ID into each Tile.

## Scene-local vs Portable

| Scope | Best for | What happens when the Tile moves? |
|---|---|---|
| **Scene-local** | Doors, cameras, fixed terminals, building networks | The binding remains locked to that Scene. |
| **Portable (World)** | Stolen laptops, carried devices, mobile terminals, recurring props | The same puzzle can be opened from any Scene. A copied/duplicated Tile keeps working when its Hexcode binding flags are preserved. |

A Portable puzzle is stored in Hexcode Breach Lite's hidden **world-level puzzle library** instead of Scene flags.

If you change a saved puzzle from Scene-local to Portable, Hexcode now shows the move as **pending** until you press Save, then confirms the conversion, moves the puzzle into the Portable World Library, upgrades matching bindings, and carries one-time reward claims with it. Moving Portable back to Scene-local likewise requires confirmation; bindings on the active Scene are converted and off-scene portable bindings are removed.

### Example: stolen laptop

1. Create `Stolen Arasaka Laptop`.
2. Set **Storage Scope → Portable (World)**.
3. Save it and bind the laptop Tile.
4. When the crew takes the laptop elsewhere, copy/duplicate that bound Tile to the new Scene, or bind a new Tile to the same Portable puzzle.
5. The Netrunner sees the same breach definition and rewards without rebuilding it on every map. The **matrix itself is freshly randomized for each live breach attempt**, so moving the laptop—or simply attempting it again—does not preserve a memorized path.

## Breach Rules

- First selection must be from the **top row**.
- Valid selections then alternate **column → row → column → row**.
- The timer starts on the **first valid hex selection**, not when the window opens.
- Grid size: **4×4 through 8×8**.
- Buffer size: **4 through 14**.
- Hex values: `1C`, `55`, `BD`, `E9`, `7A`, `FF`.
- Repeated hexcodes are allowed inside a sequence.
- A single cracked sequence secures a **partial success** and its rewards.
- Cracking every configured sequence is a **full success**.
- Every live breach attempt receives a **fresh buffer-aware matrix**. The saved GM matrix is a preview/sample, not a permanent player path.
- The planner computes an overlap cover for the configured sequences and embeds a legal top-row / alternating column-row route that fits the **actual buffer capacity**. If all sequences can fit together, at least one full-success route is embedded. If they cannot, the module embeds the strongest planned partial route instead of silently extending the buffer.
- **Overlapping sequences resolve together.** A walk such as `1C-55-1C` cracks both `1C-55` and `55-1C` in the same run, like Cyberpunk 2077 hexcode breaches.
- The buffer is a **hard capacity**. When it fills, the run ends as a full success, partial success, or failure depending on which sequences were secured.
- One Emergency Reset is allowed per run. It clears the current buffer, rebuilds the matrix again, preserves already-secured sequences, and halves the remaining timer.


### Player-loop architecture (v1.2.0)

The breach matrix intentionally keeps the simple interaction model proven in v1.0.5: click → validate → update buffer/path → detect sequences → normal Foundry render. Overlap detection remains synchronous inside that loop. Portable storage, reward claims, socket verification, and chat posting stay outside the path-selection loop. GM-authoritative reward requests are serialized so multiple sequences cracked on one click cannot race the one-time claim ledger. A fresh runtime matrix is generated once before each player window opens and is not regenerated by Application rerenders.

## Access Control

Live breaches require an Actor with either:

- the **Netrunner** Role, or
- the **Interface** Role Ability.

GM status does not bypass a live Tile activation. Use **Save + GM Preview** from the GM window when you need to test a puzzle without a Netrunner.

## Rewards

Each sequence may grant any combination of:

- Eurobucks
- an Item
- a RollTable data result

Items and RollTables can be dragged into the GM window or selected with the built-in browsers.

Configured payloads are **one-time by default**. Once a sequence pays out, Hexcode records a GM-authoritative claim tied to that puzzle/sequence, so reopening the same laptop, terminal, or portable device does not respawn its Eurobucks, Item, or RollTable data. The sequence can still be cracked again; only the already-extracted payload is withheld.

Enable **Repeatable payload** on a sequence only when the GM intentionally wants that reward/data to be available every time. The GM editor also shows one-time claim counts and provides **Reset Reward Claims** for deliberate re-arming/testing. **Save + GM Preview never grants or consumes rewards.**

### Player-account reward delivery (v1.1.0)

One-time payload claims are GM-authoritative. A player client cracks the sequence immediately, then sends a reward request over Foundry's package socket to an active GM. The GM verifies the stored puzzle/sequence, resolves the receiving Actor, grants the Item/Eurobucks/data, records the claim, and returns the result to the player.

Because the package socket namespace is declared in `module.json`, **fully restart Foundry after installing or updating Hexcode Breach Lite** before testing player rewards. This is especially important when upgrading from v1.0.5 or any pre-beta.6 test build.

## Monk's Active Tile Triggers

Press **Create Helper Macro** in the GM window. Hexcode creates or repairs:

`Hexcode Breach — Open Bound Tile`

Use that Macro in a Monk's **Run Macro** action and leave the Monk's Arguments field blank.

The helper forwards the triggering Tile, Token, Actor, and Monk's context to Hexcode Breach Lite. The Tile's Hexcode binding decides which puzzle and storage scope to open.

## Installing from GitHub

Repository: **LtAtasEDO/Hexcode-Breach-Lite**

### Foundry manifest install — stable releases

When a GitHub release includes both `module.json` and `module.zip`, paste this URL into Foundry's **Install Module → Manifest URL** field:

```text
https://github.com/LtAtasEDO/Hexcode-Breach-Lite/releases/latest/download/module.json
```

Beta builds may be distributed for manual testing before they are promoted to the repository's latest stable release.

### Manual install

1. Download `module.zip` from the desired GitHub Release.
2. Shut Foundry down completely.
3. Remove any old `Data/modules/hexcode-breach-lite/` folder when upgrading from an older or suspicious install.
4. Extract the release so the final path is:

```text
FoundryVTT/Data/modules/hexcode-breach-lite/module.json
```

5. Start Foundry and enable **Hexcode Breach Lite** in your world.

Do not install it one folder too deep. This is wrong:

```text
Data/modules/hexcode-breach-lite/hexcode-breach-lite/module.json
```

### Upgrade troubleshooting

If Foundry reports the wrong Hexcode version, the API is missing, mystery `packs` folders appear, or behavior does not match the new release:

1. Fully shut down Foundry.
2. Confirm no Foundry/Node process remains running.
3. Delete the entire `Data/modules/hexcode-breach-lite/` folder.
4. Install a fresh **Full Module** build.
5. Restart Foundry.

Overlaying new files can leave stale module content behind.

## API

```js
game.modules.get("hexcode-breach-lite").api.openGM();

// Backward-compatible lookup: active Scene first, then Portable World Library.
await game.modules.get("hexcode-breach-lite").api.openPuzzle("PUZZLE_ID");

// Explicit portable puzzle.
await game.modules.get("hexcode-breach-lite").api.openPuzzle("PUZZLE_ID", { scope: "world" });

// Monk's / bound-Tile entry point.
await game.modules.get("hexcode-breach-lite").api.openBound(typeof args === "undefined" ? null : args);

// Library inspection.
await game.modules.get("hexcode-breach-lite").api.listScenePuzzles();
await game.modules.get("hexcode-breach-lite").api.listWorldPuzzles();
```

`openPuzzle()` is still a live entry point and enforces Netrunner access.

## Companion-module / CitiNet result hook

After the player breach window actually closes:

```js
Hooks.on("closeHBLPlayerApp", (app, result) => {
  console.log(result.outcome, result.puzzleScope);
});
```

`result.outcome` is one of:

- `success` — every configured sequence was cracked.
- `partial` — at least one but not all sequences were cracked.
- `failure` — the breach formally ended with no secured sequence.
- `aborted` — the player manually closed before securing a sequence.

The result payload includes:

`reason`, `puzzleId`, `puzzleName`, `puzzleScope`, `sceneId`, `actorId`, `actorUuid`, `solvedCount`, `totalSequences`, `solvedSequenceIds`, and `gmPreview`.

Companion modules should ignore `gmPreview: true` for live unlocks.

## Storage Model

- **Scene-local puzzles:** Scene flag `flags.hexcode-breach-lite.puzzles`
- **Portable puzzles:** hidden world setting managed by Hexcode Breach Lite
- **One-time reward claims:** hidden GM-authoritative world setting managed by Hexcode Breach Lite
- **Tile bindings:** Tile flag `flags.hexcode-breach-lite.binding`

Older bindings without an explicit scope are treated as **Scene-local**, so v1.0.5 worlds do not require a data migration.

## Credits

Created by **Lt Atlas** for Cyberpunk RED on Foundry VTT, with development assistance from AI. Legacy Proof of concept Macro found at Cyberpunk Red Foundry VTT shared content discord. 

The original breach-protocol concept was inspired by community proof-of-concept work and the Cyberpunk Breach Protocol project:
https://github.com/Alexkill536ITA/cyberpunk-breach-protocol/releases/tag/Release-V1.1.0

This project is unofficial fan tooling and is not affiliated with R. Talsorian Games, Foundry Gaming LLC, or CD PROJEKT RED.
