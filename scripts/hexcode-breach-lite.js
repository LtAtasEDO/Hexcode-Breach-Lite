const HBL_ID = "hexcode-breach-lite";
const HBL_FLAG_PUZZLES = "puzzles";
const HBL_FLAG_BINDING = "binding";
const HBL_SETTING_WORLD_PUZZLES = "worldPuzzles";
const HBL_SETTING_REWARD_CLAIMS = "rewardClaims";
const HBL_SOCKET = `module.${HBL_ID}`;
const HBL_REWARD_REQUEST_TIMEOUT = 10000;
const HBL_PUSH_REQUEST_TIMEOUT = 8000;
const HBL_ROLE_DENIAL_COOLDOWN = 4000;

function hblClone(obj) {
  return foundry.utils.deepClone(obj);
}

function hblRandomId() {
  return foundry.utils.randomID(12);
}

function hblEsc(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hblNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function hblGetForm(html) {
  const root = html?.[0] ?? html ?? null;
  if (root?.tagName === "FORM") return root;
  const form = root?.querySelector?.("form") ?? null;
  return form?.tagName === "FORM" ? form : null;
}

const HBL = {
  DEFAULT_HEX: ["1C", "55", "BD", "E9", "7A", "FF"],
  roleDenialCache: new Map(),
  pendingRewardRequests: new Map(),
  pendingPushRequests: new Map(),
  rewardRequestQueue: Promise.resolve(),

  normalizeStorageScope(value) {
    return String(value || "scene").toLowerCase() === "world" ? "world" : "scene";
  },

  documentReference(doc) {
    if (!doc) return "";
    if (doc.uuid) return String(doc.uuid);
    if (doc.pack && doc.id) return `Compendium.${doc.pack}.${doc.documentName}.${doc.id}`;
    if (doc.documentName && doc.id) return `${doc.documentName}.${doc.id}`;
    return "";
  },

  async resolvePayloadNames(puzzle) {
    puzzle = this.normalizePuzzle(puzzle);
    for (const sequence of puzzle.sequences) {
      if (sequence.rewardUuid && !sequence.rewardName) {
        try {
          const item = await fromUuid(sequence.rewardUuid);
          if (item?.documentName === "Item") sequence.rewardName = item.name;
        } catch (_err) {
          // Keep the stable UUID/reference even when the source document is unavailable.
        }
      }
      if (sequence.rollTableRef && !sequence.rollTableName) {
        try {
          const table = await this.resolveRollTable(sequence.rollTableRef);
          if (table) sequence.rollTableName = table.name;
        } catch (_err) {
          // Keep the stable RollTable reference even when it cannot currently resolve.
        }
      }
    }
    return puzzle;
  },

  async prepareRuntimePuzzle(puzzle, { randomizeMatrix = true } = {}) {
    // Build one finalized runtime snapshot before the player Application starts
    // rendering. Portable storage and reward bookkeeping remain outside the
    // matrix interaction loop, matching the proven v1.0.5 architecture.
    let runtime = this.normalizePuzzle(hblClone(puzzle));
    runtime = await this.resolvePayloadNames(runtime);
    if (randomizeMatrix) runtime.matrix = this.generateSolvableMatrix(runtime);
    runtime.sequences = runtime.sequences.map(sequence => ({
      ...sequence,
      solved: false,
      rewardGranted: false
    }));
    return runtime;
  },

  TEMPLATES: {
    quick: {
      label: "Quick Access",
      description: "Compact access point or cheap consumer device.",
      gridSize: 4,
      bufferSize: 4,
      timerSeconds: 45,
      sequences: [
        { label: "Access Granted", code: ["1C", "55"] },
        { label: "Local Data Cache", code: ["BD", "E9", "7A"] }
      ]
    },
    standard: {
      label: "Standard Network",
      description: "General-purpose network breach with three daemons.",
      gridSize: 5,
      bufferSize: 6,
      timerSeconds: 60,
      sequences: [
        { label: "Basic Access", code: ["1C", "55"] },
        { label: "Camera Loop", code: ["BD", "E9", "7A"] },
        { label: "Daemon Upload", code: ["FF", "1C", "BD"] }
      ]
    },
    corporate: {
      label: "Corporate Security",
      description: "Hardened office, lab, or secured corporate subnet.",
      gridSize: 6,
      bufferSize: 7,
      timerSeconds: 75,
      sequences: [
        { label: "Credential Spoof", code: ["55", "1C", "BD"] },
        { label: "Security Control", code: ["E9", "7A", "55"] },
        { label: "Encrypted Datastore", code: ["FF", "BD", "1C", "E9"] }
      ]
    },
    blackIce: {
      label: "Black ICE Vault",
      description: "High-threat vault or protected black-file datastore.",
      gridSize: 7,
      bufferSize: 8,
      timerSeconds: 90,
      sequences: [
        { label: "ICE Suppression", code: ["BD", "E9", "55"] },
        { label: "Root Override", code: ["FF", "1C", "7A", "BD"] },
        { label: "Black File Extraction", code: ["7A", "55", "E9", "1C", "FF"] }
      ]
    }
  },

  newSequence(data = {}) {
    return {
      id: data.id || hblRandomId(),
      label: String(data.label || "New Sequence"),
      code: this.normalizeSequenceCode(data.code || []),
      eurobucks: Math.max(0, Math.trunc(hblNumber(data.eurobucks, 0))),
      rewardUuid: String(data.rewardUuid || ""),
      rewardName: String(data.rewardName || ""),
      rollTableRef: String(data.rollTableRef || data.rollTable || ""),
      rollTableName: String(data.rollTableName || ""),
      repeatableReward: Boolean(data.repeatableReward),
      solved: Boolean(data.solved),
      rewardGranted: Boolean(data.rewardGranted)
    };
  },

  defaultPuzzle() {
    return this.puzzleFromTemplate("standard", {
      id: hblRandomId(),
      name: "New Hexcode Breach",
      publicProgress: true,
      createdAt: Date.now()
    });
  },

  puzzleFromTemplate(templateKey = "standard", overrides = {}) {
    const template = this.TEMPLATES[templateKey] || this.TEMPLATES.standard;
    const sequences = template.sequences.map(sequence => this.newSequence(sequence));
    const hexPool = this.deriveHexPool(sequences);
    const puzzle = {
      id: overrides.id || hblRandomId(),
      name: overrides.name || template.label,
      templateKey,
      gridSize: template.gridSize,
      bufferSize: template.bufferSize,
      timerSeconds: template.timerSeconds,
      publicProgress: overrides.publicProgress ?? true,
      storageScope: this.normalizeStorageScope(overrides.storageScope),
      hexPool,
      matrix: [],
      sequences,
      status: "ready",
      createdAt: overrides.createdAt || Date.now(),
      updatedAt: Date.now()
    };
    puzzle.matrix = this.generateMatrix(puzzle.gridSize, puzzle.hexPool);
    return puzzle;
  },

  normalizePuzzle(raw) {
    const base = raw ? hblClone(raw) : this.defaultPuzzle();
    base.id ||= hblRandomId();
    base.name ||= "Hexcode Breach";
    base.templateKey ||= "custom";
    base.gridSize = Math.clamp(hblNumber(base.gridSize, 5), 4, 8);
    base.bufferSize = Math.clamp(hblNumber(base.bufferSize, 6), 4, 14);
    base.timerSeconds = Math.clamp(hblNumber(base.timerSeconds, 60), 0, 600);
    base.publicProgress = base.publicProgress !== false;
    base.storageScope = this.normalizeStorageScope(base.storageScope);
    const storedPool = this.normalizeHexPool(base.hexPool);
    base.sequences = Array.isArray(base.sequences)
      ? base.sequences.map(sequence => this.newSequence(sequence)).filter(sequence => sequence.code.length)
      : [];
    if (!base.sequences.length) {
      base.sequences = this.TEMPLATES.standard.sequences.map(sequence => this.newSequence(sequence));
    }

    base.hexPool = this.deriveHexPool(base.sequences);
    const poolChanged = storedPool.join("|") !== base.hexPool.join("|");

    if (
      poolChanged
      || !Array.isArray(base.matrix)
      || base.matrix.length !== base.gridSize
      || base.matrix.some(row => !Array.isArray(row) || row.length !== base.gridSize)
      || base.matrix.some(row => row.some(value => !base.hexPool.includes(value)))
    ) {
      base.matrix = this.generateMatrix(base.gridSize, base.hexPool);
    }
    return base;
  },

  normalizeSequenceCode(value) {
    const values = Array.isArray(value)
      ? value
      : this.parseCode(value || "");
    return values
      .map(entry => String(entry).trim().toUpperCase())
      .filter(entry => this.DEFAULT_HEX.includes(entry));
  },

  deriveHexPool(sequences = []) {
    const used = new Set(
      (Array.isArray(sequences) ? sequences : [])
        .flatMap(sequence => this.normalizeSequenceCode(sequence?.code || []))
    );
    const pool = this.DEFAULT_HEX.filter(entry => used.has(entry));
    return pool.length ? pool : hblClone(this.DEFAULT_HEX);
  },

  normalizeHexPool(value) {
    const values = Array.isArray(value)
      ? value
      : String(value || "").split(/[\s,;]+/);
    const pool = [...new Set(values
      .map(entry => String(entry).trim().toUpperCase())
      .filter(entry => this.DEFAULT_HEX.includes(entry)))];
    return pool.length ? this.DEFAULT_HEX.filter(entry => pool.includes(entry)) : hblClone(this.DEFAULT_HEX);
  },

  parseCode(text) {
    return String(text || "")
      .split(/[\s,;>-]+/)
      .map(entry => entry.trim().toUpperCase())
      .filter(entry => this.DEFAULT_HEX.includes(entry));
  },

  generateMatrix(size = 5, pool = this.DEFAULT_HEX) {
    size = Math.clamp(Number(size) || 5, 3, 8);
    const cleanPool = this.normalizeHexPool(pool);
    return Array.from({ length: size }, () =>
      Array.from({ length: size }, () => cleanPool[Math.floor(Math.random() * cleanPool.length)])
    );
  },

  codeContains(haystack, needle) {
    if (!needle?.length) return true;
    if (!haystack?.length || needle.length > haystack.length) return false;
    outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) {
        if (haystack[i + j] !== needle[j]) continue outer;
      }
      return true;
    }
    return false;
  },

  maxSuffixPrefixOverlap(a, b) {
    if (!a?.length || !b?.length) return 0;
    const max = Math.min(a.length, b.length);
    for (let n = max; n >= 1; n--) {
      let matched = true;
      for (let k = 0; k < n; k++) {
        if (a[a.length - n + k] !== b[k]) { matched = false; break; }
      }
      if (matched) return n;
    }
    return 0;
  },

  buildGreedyCoverCode(codes) {
    // Fast overlap heuristic used only as a safety fallback when a custom
    // puzzle contains too many independent sequences for the exact planner.
    let items = (codes ?? [])
      .map(code => (Array.isArray(code) ? code : []).slice())
      .filter(code => code.length);
    if (!items.length) return [];

    // Remove exact duplicates and codes already contained by another code.
    items = items.filter((code, index, all) => {
      const first = all.findIndex(other => other.length === code.length && other.every((value, i) => value === code[i]));
      if (first !== index) return false;
      return !all.some((other, otherIndex) => otherIndex !== index && other.length >= code.length && this.codeContains(other, code));
    });

    while (items.length > 1) {
      let best = { overlap: -1, i: 0, j: 1 };
      for (let i = 0; i < items.length; i++) {
        for (let j = 0; j < items.length; j++) {
          if (i === j) continue;
          const overlap = this.maxSuffixPrefixOverlap(items[i], items[j]);
          if (overlap > best.overlap) best = { overlap, i, j };
        }
      }
      const merged = items[best.i].concat(items[best.j].slice(Math.max(0, best.overlap)));
      items = items.filter((_, k) => k !== best.i && k !== best.j);
      items.push(merged);
    }
    return items[0] ?? [];
  },

  buildCoverPlan(codes, limit = Infinity) {
    // Build the shortest exact overlap cover for normal-sized puzzles, then
    // select the best cover that actually fits the configured buffer. This
    // keeps the CP2077-style buffer as a real capacity while still allowing
    // overlapping sequences to resolve on the same traced path.
    const originals = (codes ?? [])
      .map(code => (Array.isArray(code) ? code : []).slice())
      .filter(code => code.length);
    if (!originals.length) {
      return { code: [], full: true, coveredCount: 0, totalCount: 0, fullCoverLength: 0, exact: true };
    }

    const maxLength = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : Infinity;
    const unique = [];
    for (const code of originals) {
      if (!unique.some(other => other.length === code.length && other.every((value, i) => value === code[i]))) {
        unique.push(code);
      }
    }

    // A sequence wholly contained inside another independent sequence does
    // not need its own DP node: cracking the longer sequence cracks it too.
    const items = unique.filter((code, index, all) =>
      !all.some((other, otherIndex) => otherIndex !== index && other.length >= code.length && this.codeContains(other, code))
    );

    const scoreCover = code => {
      const covered = originals.filter(sequence => this.codeContains(code, sequence));
      return {
        coveredCount: covered.length,
        coveredHexes: covered.reduce((sum, sequence) => sum + sequence.length, 0)
      };
    };

    // Protect the browser from pathological custom editors with dozens of
    // independent sequences. Normal templates use only a handful, so the
    // exact planner handles all standard gameplay cases.
    if (items.length > 12) {
      console.warn(`${HBL_ID} | ${items.length} independent sequences exceed the exact cover planner limit; using the greedy fallback.`);
      const fullCode = this.buildGreedyCoverCode(items);
      let bestCode = fullCode.length <= maxLength ? fullCode : [];
      let bestScore = scoreCover(bestCode);

      // If the complete greedy cover does not fit, at least embed the best
      // individual/contained partial route that does fit the real buffer.
      for (const candidate of unique) {
        if (candidate.length > maxLength) continue;
        const score = scoreCover(candidate);
        if (
          score.coveredCount > bestScore.coveredCount
          || (score.coveredCount === bestScore.coveredCount && score.coveredHexes > bestScore.coveredHexes)
          || (score.coveredCount === bestScore.coveredCount && score.coveredHexes === bestScore.coveredHexes && (!bestCode.length || candidate.length < bestCode.length))
        ) {
          bestCode = candidate.slice();
          bestScore = score;
        }
      }

      return {
        code: bestCode,
        full: bestScore.coveredCount === originals.length,
        coveredCount: bestScore.coveredCount,
        totalCount: originals.length,
        fullCoverLength: fullCode.length || null,
        exact: false
      };
    }

    const count = items.length;
    const totalMasks = 1 << count;
    const dp = Array.from({ length: totalMasks }, () => Array(count).fill(null));
    for (let i = 0; i < count; i++) dp[1 << i][i] = items[i].slice();

    const isBetter = (candidate, current) => {
      if (!current) return true;
      if (candidate.length !== current.length) return candidate.length < current.length;
      return candidate.join('|') < current.join('|');
    };

    for (let mask = 1; mask < totalMasks; mask++) {
      for (let last = 0; last < count; last++) {
        const current = dp[mask][last];
        if (!current) continue;
        for (let next = 0; next < count; next++) {
          if (mask & (1 << next)) continue;
          const overlap = this.maxSuffixPrefixOverlap(items[last], items[next]);
          const candidate = current.concat(items[next].slice(overlap));
          const nextMask = mask | (1 << next);
          if (isBetter(candidate, dp[nextMask][next])) dp[nextMask][next] = candidate;
        }
      }
    }

    const fullMask = totalMasks - 1;
    let fullCode = null;
    for (let last = 0; last < count; last++) {
      const candidate = dp[fullMask][last];
      if (candidate && isBetter(candidate, fullCode)) fullCode = candidate;
    }

    let bestCode = [];
    let bestScore = scoreCover(bestCode);
    for (let mask = 1; mask < totalMasks; mask++) {
      for (let last = 0; last < count; last++) {
        const candidate = dp[mask][last];
        if (!candidate || candidate.length > maxLength) continue;
        const score = scoreCover(candidate);
        if (
          score.coveredCount > bestScore.coveredCount
          || (score.coveredCount === bestScore.coveredCount && score.coveredHexes > bestScore.coveredHexes)
          || (score.coveredCount === bestScore.coveredCount && score.coveredHexes === bestScore.coveredHexes && (!bestCode.length || candidate.length < bestCode.length))
        ) {
          bestCode = candidate.slice();
          bestScore = score;
        }
      }
    }

    return {
      code: bestCode,
      full: bestScore.coveredCount === originals.length,
      coveredCount: bestScore.coveredCount,
      totalCount: originals.length,
      fullCoverLength: fullCode?.length ?? null,
      exact: true
    };
  },

  buildCoverCode(codes) {
    // Backward-compatible helper: return the complete overlap cover when one
    // is requested without a gameplay buffer limit.
    return this.buildCoverPlan(codes, Infinity).code;
  },

  findSnakePath(size, length) {
    // Find one legal player route: top-row start, then alternating vertical /
    // horizontal moves with no revisits. The real gameplay buffer tops out at
    // 14, so an exhaustive DFS is cheap on every supported 4x4-8x8 matrix.
    if (!Number.isInteger(size) || size < 2) return null;
    if (!Number.isInteger(length) || length < 1 || length > size * size) return null;

    let found = null;
    for (let startColumn = 0; startColumn < size && !found; startColumn++) {
      const path = [[0, startColumn]];
      const seen = new Set([`0,${startColumn}`]);

      const walk = vertical => {
        if (path.length === length) return path.map(cell => cell.slice());
        const [r, c] = path[path.length - 1];
        const options = [];
        if (vertical) {
          for (let rr = 0; rr < size; rr++) {
            if (rr !== r && !seen.has(`${rr},${c}`)) options.push([rr, c]);
          }
        } else {
          for (let cc = 0; cc < size; cc++) {
            if (cc !== c && !seen.has(`${r},${cc}`)) options.push([r, cc]);
          }
        }

        // Warnsdorff-style ordering finds long routes immediately without the
        // old random 64-attempt failure mode.
        options.sort((a, b) => {
          const degree = ([rr, cc]) => {
            let total = 0;
            if (vertical) {
              for (let c2 = 0; c2 < size; c2++) if (c2 !== cc && !seen.has(`${rr},${c2}`)) total++;
            } else {
              for (let r2 = 0; r2 < size; r2++) if (r2 !== rr && !seen.has(`${r2},${cc}`)) total++;
            }
            return total;
          };
          return degree(a) - degree(b);
        });

        for (const next of options) {
          const key = `${next[0]},${next[1]}`;
          seen.add(key);
          path.push(next);
          const result = walk(!vertical);
          if (result) return result;
          path.pop();
          seen.delete(key);
        }
        return null;
      };

      found = walk(true);
    }
    if (!found) return null;

    // Random row/column bijections preserve every legal relation while making
    // the embedded route land in different cells on each fresh attempt. Row 0
    // stays row 0 so the first click remains a valid top-row selection.
    const shuffle = values => {
      const result = values.slice();
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
      }
      return result;
    };
    const rowMap = [0, ...shuffle(Array.from({ length: size - 1 }, (_, i) => i + 1))];
    const colMap = shuffle(Array.from({ length: size }, (_, i) => i));
    return found.map(([r, c]) => [rowMap[r], colMap[c]]);
  },

  generateSolvableMatrix(puzzle) {
    // Generate a fresh matrix and embed the strongest legal route that fits
    // the ACTUAL configured buffer. If every sequence can overlap within that
    // capacity the matrix guarantees a full-success route; otherwise it
    // guarantees the best planned partial route instead of removing the cap.
    const size = Math.clamp(Number(puzzle?.gridSize) || 5, 3, 8);
    const pool = this.normalizeHexPool(puzzle?.hexPool);
    const matrix = this.generateMatrix(size, pool);
    const bufferSize = Math.clamp(Number(puzzle?.bufferSize) || 6, 4, 14);
    const plan = this.buildCoverPlan((puzzle?.sequences ?? []).map(sequence => sequence.code), bufferSize);
    const cover = plan.code;
    if (!cover.length) return matrix;
    if (cover.length > size * size) {
      console.warn(`${HBL_ID} | Planned ${cover.length}-hex route cannot fit a ${size}x${size} matrix; using a plain random matrix.`);
      return matrix;
    }
    const path = this.findSnakePath(size, cover.length);
    if (!path) {
      console.warn(`${HBL_ID} | No legal ${cover.length}-step route exists on the ${size}x${size} matrix; using a plain random matrix.`);
      return matrix;
    }
    path.forEach(([r, c], index) => { matrix[r][c] = cover[index]; });
    return matrix;
  },

  getScene() {
    return canvas?.scene ?? game.scenes?.active ?? game.scenes?.current ?? null;
  },

  getControlledTileDocuments() {
    const controlled = canvas?.tiles?.controlled ?? [];
    return controlled
      .map(tile => tile?.document ?? tile)
      .filter(tile => tile?.documentName === "Tile");
  },

  getTileBinding(tile) {
    const doc = tile?.document ?? tile;
    return doc?.documentName === "Tile" ? hblClone(doc.getFlag(HBL_ID, HBL_FLAG_BINDING) || null) : null;
  },

  getBindingScope(binding) {
    return this.normalizeStorageScope(binding?.scope);
  },

  getBindingStats(puzzleId, scope = "scene") {
    scope = this.normalizeStorageScope(scope);
    const activeScene = this.getScene();
    if (!puzzleId) return { current: 0, total: 0 };

    let current = 0;
    let total = 0;
    const scenes = scope === "world" ? Array.from(game.scenes ?? []) : (activeScene ? [activeScene] : []);
    for (const scene of scenes) {
      for (const tile of scene.tiles ?? []) {
        const binding = tile.getFlag(HBL_ID, HBL_FLAG_BINDING);
        if (binding?.puzzleId !== puzzleId) continue;
        if (this.getBindingScope(binding) !== scope) continue;
        if (scope === "scene" && binding?.sceneId && binding.sceneId !== scene.id) continue;
        total += 1;
        if (scene.id === activeScene?.id) current += 1;
      }
    }
    return { current, total };
  },

  getBoundTileCount(puzzleId, scope = "scene") {
    return this.getBindingStats(puzzleId, scope).current;
  },

  async bindSelectedTiles(puzzle) {
    const scene = this.getScene();
    if (!game.user.isGM) return ui.notifications.warn("Only the GM can bind Hexcode Breach tiles.");
    if (!scene) return ui.notifications.error("No active scene found for Hexcode Breach Lite.");
    const tiles = this.getControlledTileDocuments();
    if (!tiles.length) {
      return ui.notifications.warn("Select one or more Tiles with Foundry's Tile Controls, then press Bind Selected Tile.");
    }
    puzzle = this.normalizePuzzle(puzzle);
    const scope = this.normalizeStorageScope(puzzle.storageScope);
    const binding = {
      scope,
      sceneId: scope === "scene" ? scene.id : null,
      puzzleId: puzzle.id,
      puzzleName: puzzle.name,
      boundAt: Date.now(),
      version: 3
    };
    await Promise.all(tiles.map(tile => tile.setFlag(HBL_ID, HBL_FLAG_BINDING, binding)));
    const portableText = scope === "world" ? " as a portable world breach" : "";
    ui.notifications.info(`Bound ${tiles.length} tile${tiles.length === 1 ? "" : "s"} to ${puzzle.name}${portableText} on ${scene.name}.`);
    return tiles.length;
  },

  async unbindSelectedTiles() {
    if (!game.user.isGM) return ui.notifications.warn("Only the GM can unbind Hexcode Breach tiles.");
    const tiles = this.getControlledTileDocuments();
    if (!tiles.length) {
      return ui.notifications.warn("Select one or more Tiles with Foundry's Tile Controls, then press Unbind Selected.");
    }
    await Promise.all(tiles.map(tile => tile.unsetFlag(HBL_ID, HBL_FLAG_BINDING)));
    ui.notifications.info(`Removed Hexcode Breach binding from ${tiles.length} tile${tiles.length === 1 ? "" : "s"}.`);
    return tiles.length;
  },

  async resolveTileDocument(value) {
    if (!value) return null;
    if (value.documentName === "Tile") return value;
    if (value.document?.documentName === "Tile") return value.document;
    if (value.object?.documentName === "Tile") return value.object;
    if (value.object?.document?.documentName === "Tile") return value.object.document;

    const possibleUuid = typeof value === "string" ? value : value.uuid;
    if (possibleUuid) {
      try {
        const doc = await fromUuid(possibleUuid);
        if (doc?.documentName === "Tile") return doc;
      } catch (_err) {
        // Continue to scene-local ID resolution.
      }
    }

    const possibleId = typeof value === "string" ? value : (value.id ?? value._id);
    if (possibleId) {
      const local = this.getScene()?.tiles?.get(possibleId);
      if (local?.documentName === "Tile") return local;
    }
    return null;
  },

  async findTriggerTile(args) {
    const queue = Array.isArray(args) ? [...args] : [args];
    const seen = new Set();
    const nestedKeys = [
      "tile", "tileDocument", "triggeringTile", "sourceTile",
      "origin", "document", "entity", "object",
      "action", "value", "args", "context"
    ];

    while (queue.length) {
      const candidate = queue.shift();
      if (!candidate) continue;

      if (Array.isArray(candidate)) {
        queue.unshift(...candidate);
        continue;
      }

      if (typeof candidate === "object") {
        if (seen.has(candidate)) continue;
        seen.add(candidate);
      }

      const tile = await this.resolveTileDocument(candidate);
      if (tile) return tile;

      if (typeof candidate === "object") {
        for (const key of nestedKeys) {
          if (candidate[key] != null) queue.push(candidate[key]);
        }
      }
    }

    // GM convenience only: a manually controlled Tile can still be resolved when
    // testing the helper outside Monk's Active Tile Triggers.
    return this.getControlledTileDocuments()[0] ?? null;
  },

  async resolveActorDocument(value) {
    if (!value) return null;
    if (value.documentName === "Actor") return value;
    if (value.actor?.documentName === "Actor") return value.actor;
    if (value.document?.actor?.documentName === "Actor") return value.document.actor;
    if (value.object?.actor?.documentName === "Actor") return value.object.actor;
    if (value.token?.actor?.documentName === "Actor") return value.token.actor;

    const possibleUuid = typeof value === "string" ? value : value.uuid;
    if (possibleUuid) {
      try {
        const doc = await fromUuid(possibleUuid);
        if (doc?.documentName === "Actor") return doc;
        if (doc?.actor?.documentName === "Actor") return doc.actor;
      } catch (_err) {
        // Continue through local IDs.
      }
    }

    const possibleId = typeof value === "string" ? value : (value.id ?? value._id);
    if (possibleId) {
      const actor = game.actors?.get(possibleId);
      if (actor) return actor;
      const token = this.getScene()?.tokens?.get(possibleId);
      if (token?.actor) return token.actor;
    }
    return null;
  },

  async findTriggerActor(args, { allowUserFallback = true } = {}) {
    const queue = Array.isArray(args) ? [...args] : [args];
    const seen = new Set();
    const nestedKeys = [
      "actor", "actorUuid", "actorId",
      "token", "tokenUuid", "tokenId", "tokenDocument",
      "triggeringToken", "triggeringTokens", "sourceToken",
      "tokens", "selectedTokens", "entities", "entity",
      "document", "object", "action", "value", "args"
    ];

    while (queue.length) {
      const candidate = queue.shift();
      if (!candidate) continue;

      if (Array.isArray(candidate)) {
        queue.unshift(...candidate);
        continue;
      }

      if (typeof candidate === "object") {
        if (seen.has(candidate)) continue;
        seen.add(candidate);
      }

      const actor = await this.resolveActorDocument(candidate);
      if (actor) return actor;

      if (typeof candidate === "object") {
        for (const key of nestedKeys) {
          if (candidate[key] != null) queue.push(candidate[key]);
        }
      }
    }

    return allowUserFallback ? this.getUserActor() : null;
  },

  isNetrunner(actor) {
    if (!actor) return false;
    return actor.items?.some(item => {
      if (item.type !== "role") return false;
      const roleName = String(item.name || "").trim().toLowerCase();
      const mainAbility = String(item.system?.mainRoleAbility || "").trim().toLowerCase();
      return roleName === "netrunner" || mainAbility === "interface";
    }) ?? false;
  },

  getRoleNames(actor) {
    if (!actor) return [];
    return actor.items
      ?.filter(item => item.type === "role")
      .map(item => item.name)
      .filter(Boolean) ?? [];
  },

  async postRoleDenied(actor, puzzle = null, reason = "") {
    const actorName = actor?.name || "Unverified operator";
    const key = `${game.user.id}:${actor?.id || "none"}:${this.getScene()?.id || "none"}:${reason}`;
    const now = Date.now();
    if ((this.roleDenialCache.get(key) || 0) + HBL_ROLE_DENIAL_COOLDOWN > now) return;
    this.roleDenialCache.set(key, now);

    const roles = this.getRoleNames(actor);
    const roleText = roles.length ? ` Current Role: ${roles.join(", ")}.` : "";
    const denialText = reason || `${actorName} is not a Netrunner.`;
    ui.notifications.warn(reason || "Hexcode Breach requires a Netrunner.");
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="hbl-chat-card"><h3>${hblEsc(puzzle?.name || "Hexcode Breach")}</h3><p class="hbl-fail"><b>ACCESS DENIED:</b> ${hblEsc(denialText)}</p><p>This live interface only responds to an Actor with the Netrunner Role or Interface Role Ability.${hblEsc(roleText)}</p></div>`
    });
  },

  async openPuzzle(puzzleId = null, options = {}) {
    const requestedScope = options.scope ? this.normalizeStorageScope(options.scope) : null;
    const sourceSceneId = options.sceneId ?? null;
    let puzzle = puzzleId ? await this.getPuzzle(puzzleId, { scope: requestedScope, sceneId: sourceSceneId }) : null;

    if (!puzzleId) {
      const scenePuzzles = await this.getScenePuzzles();
      puzzle = Object.values(scenePuzzles)[0] ?? null;
      if (!puzzle) {
        const worldPuzzles = await this.getWorldPuzzles();
        puzzle = Object.values(worldPuzzles)[0] ?? null;
      }
    }

    if (!puzzle) {
      const detail = puzzleId ? `: ${puzzleId}` : "";
      return ui.notifications.warn(`Hexcode Breach puzzle not found${detail}`);
    }

    const actor = options.actor ?? await this.resolveActorDocument(options.actorUuid) ?? this.getUserActor();
    if (!this.isNetrunner(actor)) {
      await this.postRoleDenied(actor, puzzle);
      return null;
    }

    const runtimePuzzle = await this.prepareRuntimePuzzle(puzzle);
    return new HBLPlayerApp({
      puzzleId: runtimePuzzle.id,
      puzzleScope: runtimePuzzle.storageScope ?? requestedScope,
      sceneId: options.sceneId ?? this.getScene()?.id ?? null,
      runtimePuzzle,
      actor,
      gmPreview: false
    }).render(true);
  },

  async openBoundTile(args = null) {
    const scene = this.getScene();
    if (!scene) return ui.notifications.error("No active scene found for Hexcode Breach Lite.");
    const tile = await this.findTriggerTile(args);
    if (!tile) return ui.notifications.warn("Hexcode Breach could not identify the triggering tile.");
    const binding = this.getTileBinding(tile);
    if (!binding?.puzzleId) return ui.notifications.warn("This tile is not bound to a Hexcode Breach puzzle.");

    const scope = this.getBindingScope(binding);
    if (scope === "scene" && binding.sceneId && binding.sceneId !== scene.id) {
      return ui.notifications.warn("This Hexcode Breach tile belongs to a different scene.");
    }

    const puzzle = await this.getPuzzle(binding.puzzleId, { scope });
    if (!puzzle) {
      const where = scope === "world" ? "the Portable World Library" : scene.name;
      return ui.notifications.warn(`Bound breach not found in ${where}: ${binding.puzzleName || binding.puzzleId}`);
    }

    const actor = await this.findTriggerActor(args, { allowUserFallback: false });
    if (!actor) {
      await this.postRoleDenied(null, puzzle, "No triggering Actor could be verified from the bound Tile activation.");
      return null;
    }
    if (!this.isNetrunner(actor)) {
      await this.postRoleDenied(actor, puzzle);
      return null;
    }
    return this.openPuzzle(binding.puzzleId, { actor, scope });
  },

  async createHelperMacro() {
    if (!game.user.isGM) return ui.notifications.warn("Only the GM can create the Hexcode Breach helper macro.");
    const name = "Hexcode Breach — Open Bound Tile";
    // Monk's Active Tile Triggers v12 supplies tile/token/actor/args to Script Macros.
    // Match the proven helper style used by the other local modules: call module.api
    // directly, avoid a global alias dependency, and let MATT/Foundry await the Promise.
    const command = `const hbl = game.modules.get("hexcode-breach-lite")?.api;
if (!hbl) return ui.notifications.error("Hexcode Breach Lite API is not available. Confirm the module is enabled, then restart Foundry.");
return hbl.openBound({
  args: typeof args === "undefined" ? null : args,
  tile: typeof tile === "undefined" ? null : tile,
  token: typeof token === "undefined" ? null : token,
  actor: typeof actor === "undefined" ? null : actor
});`;
    let macro = game.macros.getName(name);
    try {
      if (macro) {
        await macro.update({ type: "script", command, img: "systems/cyberpunk-red-core/icons/compendium/gear/computer.svg" });
        ui.notifications.info("Repaired the Hexcode Breach tile helper macro for Monk's Active Tile Triggers v12.");
      } else {
        macro = await Macro.create({
          name,
          type: "script",
          command,
          img: "systems/cyberpunk-red-core/icons/compendium/gear/computer.svg"
        });
        ui.notifications.info("Created the Hexcode Breach tile helper macro.");
      }
    } catch (err) {
      console.error(`${HBL_ID} | Failed to create/update helper Macro`, err);
      // A malformed Macro can fail Foundry joint validation before an update can repair it.
      // Fall back to replacing it with a clean Script Macro. MATT actions that referenced
      // the old Macro UUID must select the recreated helper once.
      if (macro) {
        try {
          await macro.delete();
          macro = await Macro.create({
            name,
            type: "script",
            command,
            img: "systems/cyberpunk-red-core/icons/compendium/gear/computer.svg"
          });
          ui.notifications.warn("Recreated the Hexcode Breach helper Macro because the old copy was invalid. Re-select it once in existing Monk's Run Macro actions.");
          return macro;
        } catch (replaceErr) {
          console.error(`${HBL_ID} | Failed to replace malformed helper Macro`, replaceErr);
        }
      }
      ui.notifications.error("Foundry rejected the Hexcode Breach helper Macro. Delete 'Hexcode Breach — Open Bound Tile' and press Create Helper Macro again.");
      return null;
    }
    return macro;
  },

  resolveScene(sceneRef = null) {
    if (!sceneRef) return this.getScene();
    if (sceneRef.documentName === "Scene") return sceneRef;
    return game.scenes?.get?.(String(sceneRef)) ?? null;
  },

  async getScenePuzzles(sceneRef = null) {
    const scene = this.resolveScene(sceneRef);
    if (!scene) return {};
    const stored = hblClone(scene.getFlag(HBL_ID, HBL_FLAG_PUZZLES) || {});
    return Object.fromEntries(Object.entries(stored).map(([id, puzzle]) => {
      const normalized = this.normalizePuzzle({ ...puzzle, storageScope: "scene" });
      return [id, normalized];
    }));
  },

  async replaceScenePuzzles(puzzles = {}, sceneRef = null) {
    const scene = this.resolveScene(sceneRef);
    if (!scene) return false;
    await scene.unsetFlag(HBL_ID, HBL_FLAG_PUZZLES);
    if (Object.keys(puzzles).length) {
      await scene.setFlag(HBL_ID, HBL_FLAG_PUZZLES, hblClone(puzzles));
    }
    return true;
  },

  async getWorldPuzzles() {
    const stored = hblClone(game.settings.get(HBL_ID, HBL_SETTING_WORLD_PUZZLES) || {});
    return Object.fromEntries(Object.entries(stored).map(([id, puzzle]) => {
      const normalized = this.normalizePuzzle({ ...puzzle, storageScope: "world" });
      return [id, normalized];
    }));
  },

  async replaceWorldPuzzles(puzzles = {}) {
    if (!game.user.isGM) return false;
    await game.settings.set(HBL_ID, HBL_SETTING_WORLD_PUZZLES, hblClone(puzzles));
    return true;
  },

  async getPuzzles(scope = "scene", options = {}) {
    return this.normalizeStorageScope(scope) === "world"
      ? this.getWorldPuzzles()
      : this.getScenePuzzles(options?.sceneId ?? null);
  },

  async getPuzzle(id, options = {}) {
    if (!id) return null;
    const requested = typeof options === "string" ? options : options?.scope;
    const sceneId = typeof options === "object" ? options?.sceneId : null;
    if (requested) {
      const scope = this.normalizeStorageScope(requested);
      const puzzles = await this.getPuzzles(scope, { sceneId });
      return puzzles[id] ? hblClone(puzzles[id]) : null;
    }

    // Backward-compatible lookup: old API calls search the requested/active Scene first,
    // then the Portable World Library. Tile bindings always provide an explicit scope.
    const scenePuzzles = await this.getScenePuzzles(sceneId);
    if (scenePuzzles[id]) return hblClone(scenePuzzles[id]);
    const worldPuzzles = await this.getWorldPuzzles();
    return worldPuzzles[id] ? hblClone(worldPuzzles[id]) : null;
  },

  getPrimaryActiveGM() {
    return Array.from(game.users ?? [])
      .filter(user => user?.active && user?.isGM)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0] ?? null;
  },

  userOwnsActor(user, actor) {
    if (!user || !actor) return false;
    const ownerLevel = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
    try {
      if (typeof actor.testUserPermission === "function") return actor.testUserPermission(user, ownerLevel);
      if (typeof actor.getUserLevel === "function") return actor.getUserLevel(user) >= ownerLevel;
    } catch (_err) {
      // Fall through to stored ownership data.
    }
    const ownership = actor.ownership ?? {};
    const level = Number(ownership[user.id] ?? ownership.default ?? 0);
    return level >= ownerLevel;
  },

  getPushTargets(sceneRef = null) {
    const scene = this.resolveScene(sceneRef);
    const users = Array.from(game.users ?? [])
      .filter(user => user?.active && !user?.isGM)
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    const targets = [];

    for (const user of users) {
      const owned = new Map();
      const addActor = (actor, source = "Owned Actor") => {
        if (!actor || !this.isNetrunner(actor) || !this.userOwnsActor(user, actor)) return;
        const actorUuid = String(actor.uuid || "");
        const actorId = String(actor.id || "");
        const key = actorUuid || actorId;
        if (!key || owned.has(key)) return;
        owned.set(key, {
          userId: user.id,
          userName: user.name || "Player",
          actorUuid,
          actorId,
          actorName: actor.name || "Netrunner",
          source
        });
      };

      // Current-scene owned tokens are the strongest signal for who is actually
      // at the table right now. They are listed first and deduplicated by Actor.
      for (const token of Array.from(scene?.tokens ?? [])) {
        addActor(token?.actor, `Token: ${token?.name || token?.actor?.name || "Netrunner"}`);
      }

      // Keep a player's explicitly assigned character available even when that
      // Actor does not currently have a token on the viewed Scene.
      addActor(user.character, "Assigned Character");

      // Avoid a giant selector: only scan the world Actor directory when this
      // online player has no current-scene/assigned Netrunner candidate.
      if (!owned.size) {
        for (const actor of Array.from(game.actors ?? [])) addActor(actor, "Owned Actor");
      }

      targets.push(...owned.values());
    }

    return targets.map((target, index) => ({
      ...target,
      key: String(index),
      label: `${target.userName} — ${target.actorName} (${target.source})`
    }));
  },

  async pushPuzzleToUser({ puzzleId, puzzleScope = "scene", sceneId = null, targetUserId, actorUuid = "", actorId = "" } = {}) {
    if (!game.user.isGM) {
      return { ok: false, message: "Only a GM can push a Hexcode Breach to another player." };
    }
    const scope = this.normalizeStorageScope(puzzleScope);
    const sourceSceneId = scope === "scene" ? (sceneId || this.getScene()?.id || null) : null;
    const puzzle = await this.getPuzzle(puzzleId, { scope, sceneId: sourceSceneId });
    if (!puzzle) return { ok: false, message: "That saved Hexcode Breach could not be found." };

    const targetUser = game.users?.get?.(targetUserId) ?? null;
    if (!targetUser?.active || targetUser.isGM) {
      return { ok: false, message: "That player is no longer online." };
    }

    const candidates = this.getPushTargets(sourceSceneId || this.getScene());
    const target = candidates.find(entry => entry.userId === targetUser.id && (
      (actorUuid && entry.actorUuid === actorUuid)
      || (!actorUuid && actorId && entry.actorId === actorId)
    ));
    if (!target) {
      return { ok: false, message: `${targetUser.name || "That player"} no longer has an eligible owned Netrunner for this push.` };
    }

    const requestId = hblRandomId();
    return new Promise(resolve => {
      const timeout = window.setTimeout(() => {
        this.pendingPushRequests.delete(requestId);
        resolve({ ok: false, message: `${targetUser.name || "Player"} did not acknowledge the pushed breach.` });
      }, HBL_PUSH_REQUEST_TIMEOUT);
      this.pendingPushRequests.set(requestId, { resolve, timeout });
      game.socket.emit(HBL_SOCKET, {
        type: "push-puzzle-request",
        requestId,
        senderId: game.user.id,
        targetUserId: targetUser.id,
        payload: {
          puzzleId: puzzle.id,
          puzzleScope: scope,
          sceneId: sourceSceneId,
          actorUuid: target.actorUuid,
          actorId: target.actorId
        }
      });
    });
  },

  async processPushPuzzleRequest(message = {}) {
    if (message.targetUserId !== game.user.id) return null;
    const sender = game.users?.get?.(message.senderId) ?? null;
    if (!sender?.isGM) return null;

    const payload = message.payload || {};
    const scope = this.normalizeStorageScope(payload.puzzleScope);
    const sceneId = scope === "scene" ? (payload.sceneId || null) : null;
    let actor = null;
    try { actor = await this.resolveActorDocument(payload.actorUuid || payload.actorId); } catch (_err) { actor = null; }

    if (!actor || !this.userOwnsActor(game.user, actor) || !this.isNetrunner(actor)) {
      return { ok: false, message: "The pushed breach could not verify an owned Netrunner Actor on this client." };
    }

    const puzzle = await this.getPuzzle(payload.puzzleId, { scope, sceneId });
    if (!puzzle) {
      return { ok: false, message: "The pushed Hexcode Breach is not available to this client." };
    }

    const app = await this.openPuzzle(puzzle.id, {
      scope,
      sceneId,
      actor,
      actorUuid: actor.uuid
    });
    if (!app) return { ok: false, message: "The pushed Hexcode Breach could not be opened." };

    ui.notifications.info(`Hexcode Breach received from ${sender.name || "GM"}: ${puzzle.name}`);
    return { ok: true, message: `Opened ${puzzle.name} for ${actor.name}.` };
  },

  openPushDialog(options = {}) {
    if (!game.user.isGM) return ui.notifications.warn("Only the GM can push Hexcode Breach puzzles to players.");
    return new HBLPushPlayerApp(options).render(true);
  },

  async createPushMacro() {
    if (!game.user.isGM) return ui.notifications.warn("Only the GM can create the Hexcode Breach push macro.");
    const name = "Hexcode Breach — Push to Player";
    const command = `const hbl = game.modules.get("hexcode-breach-lite")?.api;
if (!hbl) return ui.notifications.error("Hexcode Breach Lite API is not available. Confirm the module is enabled, then restart Foundry.");
if (!game.user.isGM) return ui.notifications.warn("Only the GM can push Hexcode Breach puzzles to players.");
return hbl.openPushDialog();`;
    let macro = game.macros.getName(name);
    try {
      if (macro) {
        await macro.update({ type: "script", command, img: "systems/cyberpunk-red-core/icons/compendium/gear/computer.svg" });
        ui.notifications.info("Updated the Hexcode Breach Push to Player macro.");
      } else {
        macro = await Macro.create({
          name,
          type: "script",
          command,
          img: "systems/cyberpunk-red-core/icons/compendium/gear/computer.svg"
        });
        ui.notifications.info("Created the Hexcode Breach Push to Player macro.");
      }
      return macro;
    } catch (err) {
      console.error(`${HBL_ID} | Failed to create/update Push to Player Macro`, err);
      ui.notifications.error("Foundry could not create the Hexcode Breach Push to Player macro.");
      return null;
    }
  },

  async getRewardClaims() {
    return hblClone(game.settings.get(HBL_ID, HBL_SETTING_REWARD_CLAIMS) || {});
  },

  async replaceRewardClaims(claims = {}) {
    if (!game.user.isGM) return false;
    await game.settings.set(HBL_ID, HBL_SETTING_REWARD_CLAIMS, hblClone(claims));
    return true;
  },

  sequenceHasRewards(sequence) {
    return Boolean(Math.trunc(hblNumber(sequence?.eurobucks, 0)) || sequence?.rewardUuid || sequence?.rollTableRef);
  },

  rewardClaimKey(puzzleId, sequenceId, scope = "scene", sceneId = null) {
    scope = this.normalizeStorageScope(scope);
    if (scope === "world") return `world:${puzzleId}:${sequenceId}`;
    return `scene:${sceneId || this.getScene()?.id || "unknown"}:${puzzleId}:${sequenceId}`;
  },

  rewardClaimPrefix(puzzleId, scope = "scene", sceneId = null) {
    scope = this.normalizeStorageScope(scope);
    if (scope === "world") return `world:${puzzleId}:`;
    return `scene:${sceneId || this.getScene()?.id || "unknown"}:${puzzleId}:`;
  },

  async getRewardClaimStats(puzzle, sceneId = null) {
    puzzle = this.normalizePuzzle(puzzle);
    const oneTime = puzzle.sequences.filter(sequence => this.sequenceHasRewards(sequence) && !sequence.repeatableReward);
    const claims = await this.getRewardClaims();
    const claimed = oneTime.filter(sequence => {
      const key = this.rewardClaimKey(puzzle.id, sequence.id, puzzle.storageScope, sceneId);
      return claims[key]?.status === "claimed";
    }).length;
    return { claimed, total: oneTime.length };
  },

  async clearRewardClaimsForPuzzle(puzzleId, scope = "scene", sceneId = null) {
    if (!game.user.isGM || !puzzleId) return 0;
    const claims = await this.getRewardClaims();
    const prefix = this.rewardClaimPrefix(puzzleId, scope, sceneId);
    let removed = 0;
    for (const key of Object.keys(claims)) {
      if (!key.startsWith(prefix)) continue;
      delete claims[key];
      removed += 1;
    }
    if (removed) await this.replaceRewardClaims(claims);
    return removed;
  },

  async migrateRewardClaimsForScopeChange(puzzleId, fromScope, toScope, sceneId = null) {
    if (!game.user.isGM || !puzzleId) return 0;
    fromScope = this.normalizeStorageScope(fromScope);
    toScope = this.normalizeStorageScope(toScope);
    if (fromScope === toScope) return 0;
    const claims = await this.getRewardClaims();
    const oldPrefix = this.rewardClaimPrefix(puzzleId, fromScope, sceneId);
    let moved = 0;
    for (const [key, value] of Object.entries({ ...claims })) {
      if (!key.startsWith(oldPrefix)) continue;
      const sequenceId = key.slice(oldPrefix.length);
      const newKey = this.rewardClaimKey(puzzleId, sequenceId, toScope, sceneId);
      if (!claims[newKey]) claims[newKey] = value;
      delete claims[key];
      moved += 1;
    }
    if (moved) await this.replaceRewardClaims(claims);
    return moved;
  },

  enqueueRewardRequest(work) {
    // One active GM is authoritative for claims. Serialize the COMPLETE
    // verify -> pending -> grant -> claimed transaction so two sequences that
    // crack on the same click cannot overwrite each other's claim ledger.
    const run = this.rewardRequestQueue.then(() => work());
    this.rewardRequestQueue = run.catch(err => {
      console.error(`${HBL_ID} | Reward request queue recovered from an error`, err);
    });
    return run;
  },

  async requestSequenceReward({ puzzleId, puzzleScope, sceneId, sequenceId, actorUuid, actorId }) {
    const payload = {
      puzzleId,
      puzzleScope: this.normalizeStorageScope(puzzleScope),
      sceneId,
      sequenceId,
      actorUuid,
      actorId
    };
    if (game.user.isGM) return this.enqueueRewardRequest(() => this.processSequenceRewardRequest(payload));

    const gm = this.getPrimaryActiveGM();
    if (!gm) {
      return {
        ok: false,
        html: `<div class="hbl-chat-rewards"><b>PAYLOAD:</b><ul><li class="hbl-reward-warn">Reward could not be verified because no GM is currently connected. No payload was granted.</li></ul></div>`
      };
    }

    const requestId = hblRandomId();
    return new Promise(resolve => {
      const timeout = window.setTimeout(() => {
        this.pendingRewardRequests.delete(requestId);
        resolve({
          ok: false,
          html: `<div class="hbl-chat-rewards"><b>PAYLOAD:</b><ul><li class="hbl-reward-warn">Reward verification timed out. No payload was granted.</li></ul></div>`
        });
      }, HBL_REWARD_REQUEST_TIMEOUT);
      this.pendingRewardRequests.set(requestId, { resolve, timeout });
      game.socket.emit(HBL_SOCKET, {
        type: "reward-request",
        requestId,
        senderId: game.user.id,
        targetGMId: gm.id,
        payload
      });
    });
  },

  async processSequenceRewardRequest(payload = {}) {
    if (!game.user.isGM) return { ok: false, html: "" };
    const scope = this.normalizeStorageScope(payload.puzzleScope);
    const sceneId = scope === "scene" ? payload.sceneId : null;
    const puzzle = await this.getPuzzle(payload.puzzleId, { scope, sceneId });
    if (!puzzle) return { ok: false, html: `<div class="hbl-chat-rewards"><b>PAYLOAD:</b><ul><li class="hbl-reward-warn">Reward source puzzle could not be verified.</li></ul></div>` };
    const sequence = puzzle.sequences.find(entry => entry.id === payload.sequenceId);
    if (!sequence || !this.sequenceHasRewards(sequence)) return { ok: true, html: "" };

    let actor = null;
    try { actor = payload.actorUuid ? await fromUuid(payload.actorUuid) : null; } catch (_err) { actor = null; }
    if (!actor && payload.actorId) actor = game.actors?.get(payload.actorId) ?? null;

    if (sequence.repeatableReward) {
      return this.grantSequenceRewardsLocal(actor, sequence, puzzle);
    }

    const claims = await this.getRewardClaims();
    const key = this.rewardClaimKey(puzzle.id, sequence.id, scope, sceneId);
    const existing = claims[key];
    const now = Date.now();
    if (existing?.status === "claimed" || (existing?.status === "pending" && now - Number(existing.at || 0) < 300000)) {
      return {
        ok: true,
        alreadyClaimed: true,
        html: `<div class="hbl-chat-rewards"><b>PAYLOAD:</b><ul><li class="hbl-reward-warn">Payload already extracted from this breach. The sequence can still be cracked, but its loot does not respawn.</li></ul></div>`
      };
    }

    claims[key] = {
      status: "pending",
      at: now,
      actorUuid: actor?.uuid ?? payload.actorUuid ?? null,
      actorName: actor?.name ?? null,
      puzzleId: puzzle.id,
      sequenceId: sequence.id
    };
    await this.replaceRewardClaims(claims);

    const result = await this.grantSequenceRewardsLocal(actor, sequence, puzzle);
    const refreshed = await this.getRewardClaims();
    if (result.anySuccess) {
      refreshed[key] = { ...claims[key], status: "claimed", claimedAt: Date.now() };
    } else {
      delete refreshed[key];
    }
    await this.replaceRewardClaims(refreshed);
    return result;
  },

  async migrateBindingsForScopeChange(puzzleId, fromScope, toScope, puzzleName = "Hexcode Breach") {
    fromScope = this.normalizeStorageScope(fromScope);
    toScope = this.normalizeStorageScope(toScope);
    if (fromScope === toScope || !puzzleId) return { updated: 0, removed: 0 };

    const activeScene = this.getScene();
    let updated = 0;
    let removed = 0;
    for (const scene of game.scenes ?? []) {
      for (const tile of scene.tiles ?? []) {
        const binding = tile.getFlag(HBL_ID, HBL_FLAG_BINDING);
        if (binding?.puzzleId !== puzzleId) continue;
        if (this.getBindingScope(binding) !== fromScope) continue;

        if (toScope === "world") {
          await tile.setFlag(HBL_ID, HBL_FLAG_BINDING, {
            ...binding,
            scope: "world",
            sceneId: null,
            puzzleName,
            version: 3
          });
          updated += 1;
        } else if (scene.id === activeScene?.id) {
          await tile.setFlag(HBL_ID, HBL_FLAG_BINDING, {
            ...binding,
            scope: "scene",
            sceneId: scene.id,
            puzzleName,
            version: 3
          });
          updated += 1;
        } else {
          await tile.unsetFlag(HBL_ID, HBL_FLAG_BINDING);
          removed += 1;
        }
      }
    }
    return { updated, removed };
  },

  async savePuzzle(puzzle, { scope = null, previousScope = null } = {}) {
    if (!game.user.isGM) return ui.notifications.warn("Only the GM can save breach puzzles.");
    puzzle = await this.resolvePayloadNames(puzzle);
    puzzle.id ||= hblRandomId();
    const targetScope = this.normalizeStorageScope(scope ?? puzzle.storageScope);
    const oldScope = previousScope ? this.normalizeStorageScope(previousScope) : null;
    if (targetScope === "scene" && !this.getScene()) {
      return ui.notifications.error("No active scene found for a scene-local Hexcode Breach.");
    }

    puzzle.storageScope = targetScope;
    puzzle.updatedAt = Date.now();

    if (oldScope && oldScope !== targetScope) {
      const oldPuzzles = await this.getPuzzles(oldScope);
      if (oldPuzzles[puzzle.id]) {
        delete oldPuzzles[puzzle.id];
        if (oldScope === "world") await this.replaceWorldPuzzles(oldPuzzles);
        else await this.replaceScenePuzzles(oldPuzzles);
      }
    }

    const puzzles = await this.getPuzzles(targetScope);
    puzzles[puzzle.id] = hblClone(puzzle);
    if (targetScope === "world") await this.replaceWorldPuzzles(puzzles);
    else await this.replaceScenePuzzles(puzzles);

    let migration = { updated: 0, removed: 0 };
    let migratedClaims = 0;
    if (oldScope && oldScope !== targetScope) {
      migration = await this.migrateBindingsForScopeChange(puzzle.id, oldScope, targetScope, puzzle.name);
      migratedClaims = await this.migrateRewardClaimsForScopeChange(puzzle.id, oldScope, targetScope, this.getScene()?.id ?? null);
    }

    const scopeLabel = targetScope === "world" ? "Portable World Library" : this.getScene()?.name || "Scene";
    const migrationText = migration.updated || migration.removed || migratedClaims
      ? ` Updated ${migration.updated} binding${migration.updated === 1 ? "" : "s"}${migration.removed ? ` and removed ${migration.removed} off-scene binding${migration.removed === 1 ? "" : "s"}` : ""}${migratedClaims ? `; preserved ${migratedClaims} reward claim${migratedClaims === 1 ? "" : "s"}` : ""}.`
      : "";
    ui.notifications.info(`Saved breach to ${scopeLabel}: ${puzzle.name}.${migrationText}`);
    return puzzle;
  },

  async deletePuzzle(id, { scope = "scene" } = {}) {
    scope = this.normalizeStorageScope(scope);
    const scene = this.getScene();
    if (!game.user.isGM || !id) return { ok: false, removedBindings: 0 };
    if (scope === "scene" && !scene) return { ok: false, removedBindings: 0 };

    const puzzles = await this.getPuzzles(scope);
    const existing = puzzles[id] ?? null;
    const name = existing?.name || "Hexcode Breach";
    delete puzzles[id];
    if (scope === "world") await this.replaceWorldPuzzles(puzzles);
    else await this.replaceScenePuzzles(puzzles);

    const boundTiles = [];
    const scenes = scope === "world" ? Array.from(game.scenes ?? []) : [scene];
    for (const candidateScene of scenes) {
      for (const tile of candidateScene?.tiles ?? []) {
        const binding = tile.getFlag(HBL_ID, HBL_FLAG_BINDING);
        if (binding?.puzzleId !== id) continue;
        if (this.getBindingScope(binding) !== scope) continue;
        boundTiles.push(tile);
      }
    }
    await Promise.all(boundTiles.map(tile => tile.unsetFlag(HBL_ID, HBL_FLAG_BINDING)));

    const verifyPuzzles = await this.getPuzzles(scope);
    const stillExists = Boolean(verifyPuzzles[id]);
    const stats = this.getBindingStats(id, scope);
    if (stillExists || stats.total) {
      console.error(`${HBL_ID} | Puzzle deletion verification failed`, { id, scope, stillExists, stats });
      ui.notifications.error(`Could not fully delete ${name}. Check the F12 console.`);
      return { ok: false, removedBindings: boundTiles.length };
    }

    const removedClaims = await this.clearRewardClaimsForPuzzle(id, scope, scene?.id ?? null);
    const scopeText = scope === "world" ? "Portable World Library" : scene?.name || "this scene";
    ui.notifications.info(`Deleted ${name} from ${scopeText}${boundTiles.length ? ` and removed ${boundTiles.length} tile binding${boundTiles.length === 1 ? "" : "s"}` : ""}${removedClaims ? ` plus ${removedClaims} reward claim${removedClaims === 1 ? "" : "s"}` : ""}.`);
    return { ok: true, removedBindings: boundTiles.length };
  },

  async postProgress(puzzle, html, { force = false, speaker = null } = {}) {
    if (!force && !puzzle.publicProgress) return;
    return ChatMessage.create({
      speaker: speaker ?? ChatMessage.getSpeaker(),
      content: `<div class="hbl-chat-card"><h3>${hblEsc(puzzle.name)}</h3>${html}</div>`
    });
  },

  getUserActor() {
    const token = canvas?.tokens?.controlled?.[0];
    if (token?.actor) return token.actor;
    return game.user.character ?? null;
  },

  async awardItem(actor, rewardUuid) {
    if (!rewardUuid) return null;
    if (!actor) return { ok: false, text: "Item reward could not be awarded: no actor selected." };
    try {
      if (!game.user.isGM && !actor.isOwner) return { ok: false, text: "Item reward found, but this user cannot update the actor inventory." };
      const doc = await fromUuid(rewardUuid);
      if (!doc || doc.documentName !== "Item") throw new Error("UUID did not resolve to an Item.");
      const itemData = doc.toObject();
      delete itemData._id;
      await actor.createEmbeddedDocuments("Item", [itemData]);
      return { ok: true, text: `Item acquired: ${doc.name}` };
    } catch (err) {
      console.warn(`${HBL_ID} | Item reward failed`, err);
      return { ok: false, text: `Item reward failed: ${rewardUuid}` };
    }
  },

  async adjustWealth(actor, delta, reason = "Hexcode Breach Reward") {
    delta = Math.trunc(hblNumber(delta, 0));
    if (!delta) return null;
    if (!actor) return { ok: false, text: "Eurobuck reward could not be awarded: no actor selected." };
    try {
      if (!game.user.isGM && !actor.isOwner) return { ok: false, text: "Eurobuck reward found, but this user cannot update the actor ledger." };
      const wealth = hblClone(actor.system?.wealth ?? {});
      const before = hblNumber(wealth.value, 0);
      const after = before + delta;
      wealth.value = after;
      wealth.transactions = Array.isArray(wealth.transactions) ? hblClone(wealth.transactions) : [];
      const sign = delta >= 0 ? "+" : "−";
      wealth.transactions.push([`${sign}${Math.abs(delta)}eb → ${after}eb`, reason]);
      await actor.update({ "system.wealth": wealth });
      return { ok: true, text: `${sign}${Math.abs(delta)}eb transferred to ${actor.name}.` };
    } catch (err) {
      console.warn(`${HBL_ID} | Eurobuck reward failed`, err);
      return { ok: false, text: `Eurobuck reward failed for ${actor.name}.` };
    }
  },

  async resolveRollTable(reference) {
    const ref = String(reference || "").trim();
    if (!ref) return null;

    try {
      const byUuid = await fromUuid(ref);
      if (byUuid?.documentName === "RollTable") return byUuid;
    } catch (_err) {
      // Continue through name/pack resolution.
    }

    if (ref.includes("::")) {
      const [packRaw, ...nameParts] = ref.split("::");
      const packKey = packRaw.trim();
      const tableName = nameParts.join("::").trim();
      const pack = game.packs.get(packKey)
        ?? game.packs.find(candidate => candidate.collection === packKey || candidate.metadata?.label === packKey || candidate.title === packKey);
      if (!pack || pack.documentName !== "RollTable") return null;
      const index = await pack.getIndex({ fields: ["name"] });
      const entry = index.find(item => item.name === tableName)
        ?? index.find(item => item.name?.toLowerCase() === tableName.toLowerCase());
      return entry ? pack.getDocument(entry._id) : null;
    }

    return game.tables.get(ref)
      ?? game.tables.getName(ref)
      ?? game.tables.find(table => table.name?.toLowerCase() === ref.toLowerCase())
      ?? null;
  },

  async drawData(reference) {
    if (!reference) return null;
    try {
      const table = await this.resolveRollTable(reference);
      if (!table) return { ok: false, tableName: reference, results: [`RollTable not found: ${reference}`] };
      const draw = await table.roll({ recursive: true });
      const results = draw?.results ?? draw?.RollTableDraw?.results ?? [];
      const texts = results.map(result => {
        try {
          return result.getChatText?.() || result.text || result.name || "Unknown table result";
        } catch (_err) {
          return result.text || result.name || "Unknown table result";
        }
      });
      return { ok: true, tableName: table.name, results: texts.length ? texts : ["No result was drawn."] };
    } catch (err) {
      console.warn(`${HBL_ID} | RollTable reward failed`, err);
      return { ok: false, tableName: reference, results: [`RollTable draw failed: ${reference}`] };
    }
  },

  async grantSequenceRewardsLocal(actor, sequence, puzzle) {
    const rewards = [];

    const money = await this.adjustWealth(actor, sequence.eurobucks, `Hexcode Breach: ${sequence.label}`);
    if (money) rewards.push(money);

    const item = await this.awardItem(actor, sequence.rewardUuid);
    if (item) rewards.push(item);

    const data = await this.drawData(sequence.rollTableRef);
    if (data) {
      const results = data.results.map(text => `<li>${hblEsc(text)}</li>`).join("");
      rewards.push({ ok: data.ok, html: `<b>Data acquired — ${hblEsc(data.tableName)}</b><ul>${results}</ul>` });
    }

    if (!rewards.length) return { ok: true, anySuccess: false, html: "" };
    const rows = rewards.map(reward => {
      if (reward.html) return `<li class="${reward.ok ? "hbl-reward-ok" : "hbl-reward-warn"}">${reward.html}</li>`;
      return `<li class="${reward.ok ? "hbl-reward-ok" : "hbl-reward-warn"}">${hblEsc(reward.text)}</li>`;
    }).join("");
    return {
      ok: true,
      anySuccess: rewards.some(reward => reward.ok),
      html: `<div class="hbl-chat-rewards"><b>PAYLOAD:</b><ul>${rows}</ul></div>`
    };
  },

  async grantSequenceRewards(actor, sequence, puzzle, options = {}) {
    if (sequence.rewardGranted) return "";
    sequence.rewardGranted = true;
    if (!this.sequenceHasRewards(sequence)) return "";

    if (options.gmPreview) {
      return `<div class="hbl-chat-rewards"><b>PAYLOAD:</b><ul><li class="hbl-reward-warn">GM Preview is non-destructive. Rewards were not granted or marked as claimed.</li></ul></div>`;
    }

    const result = await this.requestSequenceReward({
      puzzleId: puzzle.id,
      puzzleScope: puzzle.storageScope,
      sceneId: options.sceneId ?? this.getScene()?.id ?? null,
      sequenceId: sequence.id,
      actorUuid: actor?.uuid ?? null,
      actorId: actor?.id ?? null
    });
    return result?.html || "";
  },

  async documentFromDrop(event, expectedDocumentName) {
    const nativeEvent = event?.originalEvent ?? event;
    let data = null;
    try {
      data = TextEditor.getDragEventData(nativeEvent);
    } catch (err) {
      console.warn(`${HBL_ID} | Could not parse drag data`, err);
      return null;
    }
    if (!data) return null;

    let doc = null;
    if (data.uuid) {
      try {
        doc = await fromUuid(data.uuid);
      } catch (_err) {
        doc = null;
      }
    }
    if (!doc && data.pack && (data.id || data._id)) {
      doc = await game.packs.get(data.pack)?.getDocument(data.id || data._id);
    }
    if (!doc && (data.id || data._id)) {
      if (expectedDocumentName === "Item") doc = game.items.get(data.id || data._id);
      if (expectedDocumentName === "RollTable") doc = game.tables.get(data.id || data._id);
    }
    return doc?.documentName === expectedDocumentName ? doc : null;
  },

  openDocumentPicker(documentName, onSelect) {
    return new HBLDocumentPickerApp({ documentName, onSelect }).render(true);
  },

  api: {
    openGM: (id = null, scope = null) => new HBLGMConfigApp({ puzzleId: id, puzzleScope: scope }).render(true),
    openPuzzle: async (id = null, options = {}) => HBL.openPuzzle(id, options),
    openBound: async (args = null) => HBL.openBoundTile(args),
    bindSelectedTiles: async puzzle => HBL.bindSelectedTiles(puzzle),
    unbindSelectedTiles: async () => HBL.unbindSelectedTiles(),
    createHelperMacro: async () => HBL.createHelperMacro(),
    createPushMacro: async () => HBL.createPushMacro(),
    openPushDialog: (options = {}) => HBL.openPushDialog(options),
    pushPuzzleToUser: async options => HBL.pushPuzzleToUser(options),
    getPushTargets: (sceneRef = null) => HBL.getPushTargets(sceneRef),
    createRandom: async (scope = "scene") => HBL.savePuzzle(HBL.normalizePuzzle({ ...HBL.defaultPuzzle(), storageScope: scope }), { scope }),
    listScenePuzzles: async () => HBL.getScenePuzzles(),
    listWorldPuzzles: async () => HBL.getWorldPuzzles(),
    resolveRollTable: async reference => HBL.resolveRollTable(reference),
    isNetrunner: actor => HBL.isNetrunner(actor)
  }
};

class HBLPushPlayerApp extends Application {
  constructor(options = {}) {
    super(options);
    this.puzzleId = options.puzzleId ?? null;
    this.puzzleScope = options.puzzleScope ? HBL.normalizeStorageScope(options.puzzleScope) : null;
    this.sceneId = options.sceneId ?? HBL.getScene()?.id ?? null;
    this.lockPuzzle = Boolean(options.lockPuzzle && this.puzzleId);
    this.targets = [];
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "hbl-push-player",
      title: "Hexcode Breach Lite — Push to Player",
      template: `modules/${HBL_ID}/templates/push-player.hbs`,
      width: 560,
      height: "auto",
      resizable: true,
      classes: ["hbl", "hbl-push-player"]
    });
  }

  async getData() {
    const scenePuzzles = await HBL.getScenePuzzles(this.sceneId);
    const worldPuzzles = await HBL.getWorldPuzzles();
    const puzzleOptions = [
      ...Object.values(scenePuzzles).map(puzzle => ({
        id: puzzle.id,
        name: puzzle.name,
        scope: "scene",
        scopeLabel: "SCENE",
        key: `scene::${puzzle.id}`
      })),
      ...Object.values(worldPuzzles).map(puzzle => ({
        id: puzzle.id,
        name: puzzle.name,
        scope: "world",
        scopeLabel: "PORTABLE",
        key: `world::${puzzle.id}`
      }))
    ].sort((a, b) => String(a.name).localeCompare(String(b.name)));

    let selectedKey = this.puzzleId ? `${this.puzzleScope || "scene"}::${this.puzzleId}` : "";
    if (!puzzleOptions.some(option => option.key === selectedKey)) selectedKey = puzzleOptions[0]?.key || "";
    for (const option of puzzleOptions) option.selected = option.key === selectedKey;

    this.targets = HBL.getPushTargets(this.sceneId);
    const selectedPuzzle = puzzleOptions.find(option => option.key === selectedKey) ?? null;

    return {
      puzzleOptions,
      selectedPuzzle,
      lockPuzzle: this.lockPuzzle,
      targets: this.targets,
      hasTargets: this.targets.length > 0,
      hasPuzzles: puzzleOptions.length > 0,
      sceneName: HBL.resolveScene(this.sceneId)?.name ?? HBL.getScene()?.name ?? "No Active Scene"
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find("[data-action='cancel']").on("click", () => this.close());
    html.find("[data-action='push']").on("click", async () => {
      const form = hblGetForm(html);
      if (!form) return ui.notifications.error("Hexcode Breach push form could not be found.");
      const puzzleKey = String(form.querySelector("[name='puzzleKey']")?.value || "");
      const targetKey = String(form.querySelector("[name='targetKey']")?.value || "");
      const [scope, puzzleId] = puzzleKey.split("::", 2);
      const target = this.targets.find(entry => entry.key === targetKey);
      if (!puzzleId) return ui.notifications.warn("Choose a saved Hexcode Breach puzzle.");
      if (!target) return ui.notifications.warn("Choose an online player with an owned Netrunner.");

      const result = await HBL.pushPuzzleToUser({
        puzzleId,
        puzzleScope: scope,
        sceneId: this.sceneId,
        targetUserId: target.userId,
        actorUuid: target.actorUuid,
        actorId: target.actorId
      });
      if (!result?.ok) return ui.notifications.warn(result?.message || "The Hexcode Breach push was not acknowledged.");
      ui.notifications.info(`${target.userName} acknowledged the breach push. ${result.message || ""}`.trim());
      await this.close();
    });
  }
}

class HBLDocumentPickerApp extends Application {
  constructor(options = {}) {
    super(options);
    this.documentName = options.documentName;
    this.onSelect = options.onSelect;
    this.catalog = null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "hbl-document-picker",
      title: "Hexcode Reward Browser",
      template: `modules/${HBL_ID}/templates/document-picker.hbs`,
      width: 650,
      height: 620,
      resizable: true,
      classes: ["hbl", "hbl-picker"]
    });
  }

  async buildCatalog() {
    if (this.catalog) return this.catalog;
    const entries = [];
    const worldCollection = this.documentName === "Item" ? game.items : game.tables;
    for (const doc of worldCollection) {
      entries.push({
        name: doc.name,
        source: "World",
        img: doc.img || "icons/svg/d20-black.svg",
        doc
      });
    }

    const packs = game.packs.filter(pack => pack.documentName === this.documentName);
    for (const pack of packs) {
      try {
        const index = await pack.getIndex({ fields: ["name", "img"] });
        for (const entry of index) {
          entries.push({
            name: entry.name,
            source: pack.metadata?.label || pack.title || pack.collection,
            img: entry.img || "icons/svg/d20-black.svg",
            pack: pack.collection,
            id: entry._id
          });
        }
      } catch (err) {
        console.warn(`${HBL_ID} | Could not index ${pack.collection}`, err);
      }
    }
    this.catalog = entries.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return this.catalog;
  }

  async getData() {
    await this.buildCatalog();
    return {
      label: this.documentName === "Item" ? "Item Reward" : "Data RollTable",
      placeholder: this.documentName === "Item" ? "Search world Items and Item compendiums…" : "Search world RollTables and RollTable compendiums…",
      total: this.catalog.length
    };
  }

  renderResults(html, query = "") {
    const needle = String(query || "").trim().toLowerCase();
    const filtered = this.catalog
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => !needle || `${entry.name} ${entry.source}`.toLowerCase().includes(needle))
      .slice(0, 150);

    const rows = filtered.map(({ entry, index }) => `
      <button type="button" class="hbl-picker-row" data-action="choose-document" data-index="${index}">
        <img src="${hblEsc(entry.img)}" alt="" />
        <span><b>${hblEsc(entry.name)}</b><small>${hblEsc(entry.source)}</small></span>
        <i class="fas fa-plus"></i>
      </button>
    `).join("");
    html.find(".hbl-picker-results").html(rows || `<p class="hbl-muted">No matching ${hblEsc(this.documentName)} documents found.</p>`);
    html.find(".hbl-picker-count").text(`${filtered.length} shown / ${this.catalog.length} indexed`);
  }

  activateListeners(html) {
    super.activateListeners(html);
    this.renderResults(html, "");
    html.find("[name='pickerSearch']").on("input", event => this.renderResults(html, event.currentTarget.value));
    html.on("click", "[data-action='choose-document']", async event => {
      const entry = this.catalog[Number(event.currentTarget.dataset.index)];
      if (!entry) return;
      let doc = entry.doc ?? null;
      if (!doc && entry.pack && entry.id) doc = await game.packs.get(entry.pack)?.getDocument(entry.id);
      if (!doc) return ui.notifications.warn(`${this.documentName} could not be loaded.`);
      await this.onSelect?.(doc);
      return this.close();
    });
  }
}

class HBLGMConfigApp extends Application {
  constructor(options = {}) {
    super(options);
    this.puzzleId = options.puzzleId ?? null;
    this.puzzleScope = options.puzzleScope ? HBL.normalizeStorageScope(options.puzzleScope) : null;
    this.loadedScope = this.puzzleScope;
    this.puzzle = null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "hbl-gm-config",
      title: "Hexcode Breach Lite — GM Config",
      template: `modules/${HBL_ID}/templates/gm-config.hbs`,
      width: 980,
      height: 820,
      resizable: true,
      classes: ["hbl", "hbl-gm"]
    });
  }

  async resolveRewardNames() {
    this.puzzle = await HBL.resolvePayloadNames(this.puzzle);
  }

  async getData() {
    const scenePuzzles = await HBL.getScenePuzzles();
    const worldPuzzles = await HBL.getWorldPuzzles();

    if (this.puzzleId && !this.puzzle) {
      let loaded = null;
      if (this.puzzleScope === "world") loaded = worldPuzzles[this.puzzleId] ?? null;
      else if (this.puzzleScope === "scene") loaded = scenePuzzles[this.puzzleId] ?? null;
      else loaded = scenePuzzles[this.puzzleId] ?? worldPuzzles[this.puzzleId] ?? null;

      if (loaded) {
        this.puzzle = HBL.normalizePuzzle(loaded);
        this.puzzleScope = this.puzzle.storageScope;
        this.loadedScope = this.puzzleScope;
      }
    }

    if (!this.puzzle) {
      this.puzzle = HBL.defaultPuzzle();
      this.puzzleScope = "scene";
      this.loadedScope = null;
    }
    this.puzzle = HBL.normalizePuzzle(this.puzzle);
    this.puzzle.storageScope = HBL.normalizeStorageScope(this.puzzle.storageScope ?? this.puzzleScope);
    this.puzzleScope = this.puzzle.storageScope;
    await this.resolveRewardNames();

    const persistedScope = this.loadedScope ?? this.puzzle.storageScope;
    const persistedPuzzleForStats = { ...this.puzzle, storageScope: persistedScope };
    const bindingStats = HBL.getBindingStats(this.puzzle.id, persistedScope);
    const rewardClaimStats = await HBL.getRewardClaimStats(persistedPuzzleForStats, HBL.getScene()?.id ?? null);
    const currentKey = this.puzzleId ? `${persistedScope}::${this.puzzleId}` : "";
    const scopeChangePending = Boolean(this.puzzleId && this.loadedScope && this.loadedScope !== this.puzzle.storageScope);
    const mapOption = (puzzle, scope) => ({
      ...puzzle,
      selectionKey: `${scope}::${puzzle.id}`,
      selected: currentKey === `${scope}::${puzzle.id}`
    });
    const sortByName = (a, b) => String(a.name).localeCompare(String(b.name));
    const scopeIsWorld = this.puzzle.storageScope === "world";

    return {
      puzzle: this.puzzle,
      scenePuzzles: Object.values(scenePuzzles).map(p => mapOption(p, "scene")).sort(sortByName),
      worldPuzzles: Object.values(worldPuzzles).map(p => mapOption(p, "world")).sort(sortByName),
      templates: Object.entries(HBL.TEMPLATES).map(([key, value]) => ({ key, ...value })),
      sceneName: HBL.getScene()?.name ?? "No Active Scene",
      scopeIsWorld,
      storageScopeLabel: scopeIsWorld ? "Portable (World)" : "Scene-local",
      boundTileCount: bindingStats.current,
      boundTileTotal: bindingStats.total,
      saveButtonLabel: scopeChangePending
        ? (scopeIsWorld ? "Move to Portable World" : "Move to Current Scene")
        : (scopeIsWorld ? "Save Portable Puzzle" : "Save to Scene"),
      scopeChangePending,
      persistedScopeLabel: persistedScope === "world" ? "Portable (World)" : "Scene-local",
      rewardClaimedCount: rewardClaimStats.claimed,
      rewardClaimTotal: rewardClaimStats.total,
      bindingScopeHelp: scopeIsWorld
        ? "Portable bindings use the world puzzle library. Copy this bound Tile to another Scene and it can open the same breach there."
        : "Scene-local bindings remain locked to this Scene. Copying the Tile elsewhere will not open the breach.",
      helperCommand: `const hbl = game.modules.get("hexcode-breach-lite")?.api;\nif (!hbl) return ui.notifications.error("Hexcode Breach Lite API is not available. Confirm the module is enabled, then restart Foundry.");\nreturn hbl.openBound({\n  args: typeof args === "undefined" ? null : args,\n  tile: typeof tile === "undefined" ? null : tile,\n  token: typeof token === "undefined" ? null : token,\n  actor: typeof actor === "undefined" ? null : actor\n});`,
      hasSavedPuzzle: Boolean(this.puzzleId && (persistedScope === "world" ? worldPuzzles[this.puzzleId] : scenePuzzles[this.puzzleId])),
      hexPoolValue: this.puzzle.hexPool.join(" "),
      hexChoices: HBL.DEFAULT_HEX.map(value => ({ value, active: this.puzzle.hexPool.includes(value) })),
      sequenceRows: this.puzzle.sequences.map((sequence, index) => ({
        ...sequence,
        index,
        displayIndex: index + 1,
        codeText: sequence.code.join(" "),
        codeDisplay: sequence.code.join(" → "),
        codeChoices: HBL.DEFAULT_HEX.map(value => ({
          value,
          count: sequence.code.filter(entry => entry === value).length,
          sequenceIndex: index
        })),
        codeTokens: sequence.code.map((value, position) => ({
          value,
          position,
          displayPosition: position + 1,
          sequenceIndex: index
        })),
        canDeleteSequence: this.puzzle.sequences.length > 1,
        rewardDisplay: sequence.rewardName || sequence.rewardUuid || "Drop an Item here or browse",
        tableDisplay: sequence.rollTableName || sequence.rollTableRef || "Drop a RollTable here or browse",
        rewardLoaded: Boolean(sequence.rewardUuid),
        tableLoaded: Boolean(sequence.rollTableRef),
        rewardFieldDisplay: sequence.rewardUuid
          ? `${sequence.rewardName || "Item"} — ${sequence.rewardUuid}`
          : "",
        tableFieldDisplay: sequence.rollTableRef
          ? `${sequence.rollTableName || "RollTable"} — ${sequence.rollTableRef}`
          : ""
      }))
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find("[data-action='new']").on("click", () => {
      this.puzzle = HBL.defaultPuzzle();
      this.puzzleId = null;
      this.puzzleScope = "scene";
      this.loadedScope = null;
      this.render();
    });

    html.find("[data-action='load']").on("change", event => {
      const value = String(event.currentTarget.value || "");
      if (!value) {
        this.puzzleId = null;
        this.puzzleScope = "scene";
        this.loadedScope = null;
        this.puzzle = HBL.defaultPuzzle();
        return this.render();
      }
      const [scope, id] = value.split("::", 2);
      this.puzzleScope = HBL.normalizeStorageScope(scope);
      this.loadedScope = this.puzzleScope;
      this.puzzleId = id || null;
      this.puzzle = null;
      this.render();
    });

    html.find("[name='storageScope']").on("change", () => {
      if (!this._updatePuzzleFromForm(html)) return;
      if (!this.puzzleId) this.puzzleScope = this.puzzle.storageScope;
      this.render();
    });

    html.find("[data-action='append-sequence-hex']").on("click", event => {
      if (!this._updatePuzzleFromForm(html)) return;
      const index = Number(event.currentTarget.dataset.index);
      const value = String(event.currentTarget.dataset.hex || "").toUpperCase();
      const sequence = this.puzzle.sequences[index];
      if (!sequence || !HBL.DEFAULT_HEX.includes(value)) return;

      sequence.code.push(value);
      this.puzzle.templateKey = "custom";
      this.puzzle.hexPool = HBL.deriveHexPool(this.puzzle.sequences);
      this.puzzle.matrix = HBL.generateMatrix(this.puzzle.gridSize, this.puzzle.hexPool);
      this.render();
    });

    html.find("[data-action='remove-sequence-hex']").on("click", event => {
      if (!this._updatePuzzleFromForm(html)) return;
      const index = Number(event.currentTarget.dataset.index);
      const position = Number(event.currentTarget.dataset.position);
      const sequence = this.puzzle.sequences[index];
      if (!sequence || !Number.isInteger(position) || position < 0 || position >= sequence.code.length) return;
      if (sequence.code.length === 1) {
        return ui.notifications.warn("Each breach sequence must contain at least one hexcode.");
      }

      sequence.code.splice(position, 1);
      this.puzzle.templateKey = "custom";
      this.puzzle.hexPool = HBL.deriveHexPool(this.puzzle.sequences);
      this.puzzle.matrix = HBL.generateMatrix(this.puzzle.gridSize, this.puzzle.hexPool);
      this.render();
    });

    html.find("[data-action='apply-template']").on("click", () => {
      const form = hblGetForm(html);
      if (!form) return ui.notifications.error("Hexcode Breach GM form could not be found. Please close and reopen the window.");
      const key = form.querySelector("[name='templateKey']")?.value || "standard";
      if (!HBL.TEMPLATES[key]) return ui.notifications.info("Choose a named network template to apply.");
      const currentName = form.querySelector("[name='name']")?.value?.trim();
      this.puzzle = HBL.puzzleFromTemplate(key, {
        id: this.puzzle?.id || hblRandomId(),
        name: currentName || HBL.TEMPLATES[key]?.label || "Hexcode Breach",
        publicProgress: form.querySelector("[name='publicProgress']")?.checked ?? true,
        storageScope: this.puzzle?.storageScope || this.puzzleScope || "scene",
        createdAt: this.puzzle?.createdAt || Date.now()
      });
      this.render();
    });

    html.find("[data-action='add-sequence']").on("click", () => {
      if (!this._updatePuzzleFromForm(html)) return;
      this.puzzle.sequences.push(HBL.newSequence({ label: "New Sequence", code: ["1C", "55"] }));
      this.render();
    });

    html.find("[data-action='remove-sequence']").on("click", event => {
      if (!this._updatePuzzleFromForm(html)) return;
      if (this.puzzle.sequences.length <= 1) {
        return ui.notifications.warn("A breach puzzle must retain at least one sequence.");
      }
      const sequenceId = String(event.currentTarget.dataset.sequenceId || "");
      let index = sequenceId
        ? this.puzzle.sequences.findIndex(sequence => sequence.id === sequenceId)
        : Number(event.currentTarget.dataset.index);
      if (!Number.isInteger(index) || index < 0 || index >= this.puzzle.sequences.length) {
        return ui.notifications.warn("That sequence could not be found. Close and reopen the GM window, then try again.");
      }
      const [removed] = this.puzzle.sequences.splice(index, 1);
      this.puzzle.templateKey = "custom";
      this.puzzle.hexPool = HBL.deriveHexPool(this.puzzle.sequences);
      this.puzzle.matrix = HBL.generateMatrix(this.puzzle.gridSize, this.puzzle.hexPool);
      ui.notifications.info(`Removed sequence: ${removed?.label || "Sequence"}. Save the puzzle to persist the change.`);
      this.render(true);
    });

    html.find("[data-action='rebuild']").on("click", () => {
      if (!this._updatePuzzleFromForm(html)) return;
      this.puzzle.matrix = HBL.generateMatrix(this.puzzle.gridSize, this.puzzle.hexPool);
      this.render();
    });

    html.find("[data-action='save']").on("click", async () => {
      if (!this._updatePuzzleFromForm(html)) return;
      const saved = await this.saveCurrentPuzzle();
      if (saved) this.render();
    });

    html.find("[data-action='open-player']").on("click", async () => {
      if (!this._updatePuzzleFromForm(html)) return;
      const saved = await this.saveCurrentPuzzle();
      if (saved?.id) {
        const runtimePuzzle = await HBL.prepareRuntimePuzzle(saved);
        new HBLPlayerApp({
          puzzleId: saved.id,
          puzzleScope: saved.storageScope,
          sceneId: HBL.getScene()?.id ?? null,
          runtimePuzzle,
          actor: HBL.getUserActor(),
          gmPreview: true
        }).render(true);
      }
    });

    html.find("[data-action='bind-tile']").on("click", async () => {
      if (!this._updatePuzzleFromForm(html)) return;
      const saved = await this.saveCurrentPuzzle();
      if (!saved?.id) return;
      await HBL.bindSelectedTiles(saved);
      this.render();
    });

    html.find("[data-action='unbind-tile']").on("click", async () => {
      await HBL.unbindSelectedTiles();
      this.render();
    });

    html.find("[data-action='create-helper']").on("click", async () => HBL.createHelperMacro());
    html.find("[data-action='create-push-helper']").on("click", async () => HBL.createPushMacro());
    html.find("[data-action='push-player']").on("click", async () => {
      if (!this._updatePuzzleFromForm(html)) return;
      const saved = await this.saveCurrentPuzzle();
      if (!saved?.id) return;
      HBL.openPushDialog({
        puzzleId: saved.id,
        puzzleScope: saved.storageScope,
        sceneId: HBL.getScene()?.id ?? null,
        lockPuzzle: true
      });
    });
    html.find("[data-action='reset-rewards']").on("click", async () => this.resetRewardClaims());
    html.find("[data-action='delete']").on("click", async () => this.deleteCurrentPuzzle());

    html.find(".hbl-document-drop").on("dragover", event => {
      event.preventDefault();
      event.currentTarget.classList.add("dragover");
    }).on("dragleave", event => event.currentTarget.classList.remove("dragover"))
      .on("drop", async event => {
        event.preventDefault();
        event.currentTarget.classList.remove("dragover");
        const index = Number(event.currentTarget.dataset.index);
        const kind = event.currentTarget.dataset.kind;
        const expected = kind === "item" ? "Item" : "RollTable";
        const doc = await HBL.documentFromDrop(event, expected);
        if (!doc) return ui.notifications.warn(`Drop a ${expected} document from the sidebar or a compendium.`);
        if (!this._updatePuzzleFromForm(html)) return;
        this.setSequenceDocument(index, kind, doc);
        this.render(true);
      });

    html.find("[data-action='browse-item']").on("click", event => {
      const index = Number(event.currentTarget.dataset.index);
      if (!this._updatePuzzleFromForm(html)) return;
      HBL.openDocumentPicker("Item", async doc => {
        this.setSequenceDocument(index, "item", doc);
        this.render(true);
      });
    });

    html.find("[data-action='browse-table']").on("click", event => {
      const index = Number(event.currentTarget.dataset.index);
      if (!this._updatePuzzleFromForm(html)) return;
      HBL.openDocumentPicker("RollTable", async doc => {
        this.setSequenceDocument(index, "table", doc);
        this.render(true);
      });
    });

    html.find("[data-action='clear-item']").on("click", event => {
      const index = Number(event.currentTarget.dataset.index);
      if (!this._updatePuzzleFromForm(html)) return;
      this.puzzle.sequences[index].rewardUuid = "";
      this.puzzle.sequences[index].rewardName = "";
      this.render();
    });

    html.find("[data-action='clear-table']").on("click", event => {
      const index = Number(event.currentTarget.dataset.index);
      if (!this._updatePuzzleFromForm(html)) return;
      this.puzzle.sequences[index].rollTableRef = "";
      this.puzzle.sequences[index].rollTableName = "";
      this.render();
    });

    html.find("[data-action='test-table']").on("click", async event => {
      const index = Number(event.currentTarget.dataset.index);
      if (!this._updatePuzzleFromForm(html)) return;
      const sequence = this.puzzle.sequences[index];
      if (!sequence?.rollTableRef) return ui.notifications.warn("Select or drop a RollTable first.");
      const data = await HBL.drawData(sequence.rollTableRef);
      const results = data?.results?.map(result => `<li>${result}</li>`).join("") || "<li>No result.</li>";
      return new Dialog({
        title: `RollTable Test — ${data?.tableName || sequence.rollTableRef}`,
        content: `<div class="hbl-chat-card"><h3>Non-destructive Test Roll</h3><ul>${results}</ul></div>`,
        buttons: { close: { label: "Close" } }
      }).render(true);
    });
  }

  setSequenceDocument(index, kind, doc) {
    const sequence = this.puzzle.sequences[index];
    if (!sequence) return;
    if (kind === "item" && doc.documentName === "Item") {
      const reference = HBL.documentReference(doc);
      if (!reference) return ui.notifications.warn(`Could not create a stable reference for Item: ${doc.name}`);
      sequence.rewardUuid = reference;
      sequence.rewardName = doc.name;
      ui.notifications.info(`Item reward loaded: ${doc.name}`);
    }
    if (kind === "table" && doc.documentName === "RollTable") {
      const reference = HBL.documentReference(doc);
      if (!reference) return ui.notifications.warn(`Could not create a stable reference for RollTable: ${doc.name}`);
      sequence.rollTableRef = reference;
      sequence.rollTableName = doc.name;
      ui.notifications.info(`Data RollTable loaded: ${doc.name}`);
    }
  }

  async saveCurrentPuzzle() {
    const targetScope = HBL.normalizeStorageScope(this.puzzle?.storageScope ?? this.puzzleScope ?? "scene");
    if (this.puzzleId && this.loadedScope && this.loadedScope !== targetScope) {
      const movingToWorld = targetScope === "world";
      const ok = await Dialog.confirm({
        title: movingToWorld ? "Move Breach to Portable World Library?" : "Move Breach to Current Scene?",
        content: movingToWorld
          ? `<p>Move <b>${hblEsc(this.puzzle.name)}</b> from this Scene into the <b>Portable World Library</b>? Existing Scene bindings will be upgraded to portable bindings and one-time reward claims will follow the puzzle.</p>`
          : `<p>Move <b>${hblEsc(this.puzzle.name)}</b> from the <b>Portable World Library</b> into <b>${hblEsc(HBL.getScene()?.name || "the current Scene")}</b>? Portable bindings on other Scenes will be removed and one-time reward claims will follow the puzzle.</p>`
      });
      if (!ok) return null;
    }

    const saved = await HBL.savePuzzle(this.puzzle, {
      scope: targetScope,
      previousScope: this.loadedScope
    });
    if (!saved?.id) return null;
    this.puzzleId = saved.id;
    this.puzzleScope = saved.storageScope;
    this.loadedScope = saved.storageScope;
    this.puzzle = saved;
    return saved;
  }

  async deleteCurrentPuzzle() {
    if (!this.puzzleId) return ui.notifications.warn("Load a saved breach before deleting it.");
    const scope = HBL.normalizeStorageScope(this.loadedScope ?? this.puzzleScope ?? this.puzzle?.storageScope);
    const targetText = scope === "world"
      ? "the Portable World Library and remove its portable Tile bindings from every Scene"
      : `the Scene Library on <b>${hblEsc(HBL.getScene()?.name || "this scene")}</b>`;
    const ok = await Dialog.confirm({
      title: scope === "world" ? "Delete Portable Breach?" : "Delete Scene Breach?",
      content: `<p>Delete <b>${hblEsc(this.puzzle.name)}</b> from ${targetText}?</p>`
    });
    if (!ok) return;
    const result = await HBL.deletePuzzle(this.puzzleId, { scope });
    if (!result?.ok) return;
    this.puzzle = null;
    this.puzzleId = null;
    this.puzzleScope = "scene";
    this.loadedScope = null;
    await this.render(true);
  }

  async resetRewardClaims() {
    if (!this.puzzleId) return ui.notifications.warn("Save the breach before resetting reward claims.");
    const scope = HBL.normalizeStorageScope(this.loadedScope ?? this.puzzleScope ?? this.puzzle?.storageScope);
    const ok = await Dialog.confirm({
      title: "Reset One-Time Payload Claims?",
      content: `<p>Re-arm all one-time rewards for <b>${hblEsc(this.puzzle?.name || "this breach")}</b>? Players will be able to extract those payloads again.</p>`
    });
    if (!ok) return;
    const removed = await HBL.clearRewardClaimsForPuzzle(this.puzzleId, scope, HBL.getScene()?.id ?? null);
    ui.notifications.info(removed ? `Reset ${removed} reward claim${removed === 1 ? "" : "s"}.` : "No one-time reward claims were stored for this breach.");
    this.render();
  }

  _updatePuzzleFromForm(html) {
    const form = hblGetForm(html);
    if (!form) {
      console.error(`${HBL_ID} | GM form root was not an HTMLFormElement`, html?.[0] ?? html);
      ui.notifications.error("Hexcode Breach GM form could not be found. Please close and reopen the window.");
      return false;
    }
    const fd = new FormData(form);
    this.puzzle = HBL.normalizePuzzle(this.puzzle);
    this.puzzle.name = String(fd.get("name") || "Hexcode Breach");
    this.puzzle.templateKey = String(fd.get("templateKey") || "custom");
    this.puzzle.gridSize = Math.clamp(Number(fd.get("gridSize")) || 5, 4, 8);
    this.puzzle.bufferSize = Math.clamp(Number(fd.get("bufferSize")) || 6, 4, 14);
    this.puzzle.timerSeconds = Math.clamp(Number(fd.get("timerSeconds")) || 0, 0, 600);
    this.puzzle.publicProgress = fd.get("publicProgress") === "on";
    this.puzzle.storageScope = HBL.normalizeStorageScope(fd.get("storageScope") || this.puzzle.storageScope || this.puzzleScope);
    if (!this.puzzleId) this.puzzleScope = this.puzzle.storageScope;
    const previousPool = hblClone(this.puzzle.hexPool);

    const sequenceCount = Math.max(0, Number(fd.get("sequenceCount")) || this.puzzle.sequences.length);
    const sequences = [];
    for (let i = 0; i < sequenceCount; i++) {
      const existing = this.puzzle.sequences[i] || {};
      const label = String(fd.get(`sequences.${i}.label`) || "").trim();
      const code = HBL.parseCode(fd.get(`sequences.${i}.code`) || "");
      if (!label && !code.length) continue;
      sequences.push(HBL.newSequence({
        id: fd.get(`sequences.${i}.id`) || existing.id || hblRandomId(),
        label: label || "Sequence",
        code,
        eurobucks: fd.get(`sequences.${i}.eurobucks`),
        rewardUuid: fd.get(`sequences.${i}.rewardUuid`),
        rewardName: fd.get(`sequences.${i}.rewardName`) || existing.rewardName,
        rollTableRef: fd.get(`sequences.${i}.rollTableRef`),
        rollTableName: fd.get(`sequences.${i}.rollTableName`) || existing.rollTableName,
        repeatableReward: fd.get(`sequences.${i}.repeatableReward`) === "on"
      }));
    }
    this.puzzle.sequences = sequences.length
      ? sequences
      : [HBL.newSequence({ label: "Basic Access", code: ["1C", "55"] })];

    this.puzzle.hexPool = HBL.deriveHexPool(this.puzzle.sequences);
    const poolChanged = previousPool.join("|") !== this.puzzle.hexPool.join("|");

    if (
      poolChanged
      || !this.puzzle.matrix?.length
      || this.puzzle.matrix.length !== this.puzzle.gridSize
      || this.puzzle.matrix.some(row => row.length !== this.puzzle.gridSize)
      || this.puzzle.matrix.some(row => row.some(value => !this.puzzle.hexPool.includes(value)))
    ) {
      this.puzzle.matrix = HBL.generateMatrix(this.puzzle.gridSize, this.puzzle.hexPool);
    }
    return true;
  }
}

class HBLPlayerApp extends Application {
  constructor(options = {}) {
    super(options);
    this.puzzleId = options.puzzleId ?? options.runtimePuzzle?.id ?? null;
    this.puzzleScope = options.puzzleScope
      ? HBL.normalizeStorageScope(options.puzzleScope)
      : HBL.normalizeStorageScope(options.runtimePuzzle?.storageScope);
    this.sourceSceneId = options.sceneId ?? HBL.getScene()?.id ?? null;
    this.puzzle = options.runtimePuzzle ? HBL.normalizePuzzle(hblClone(options.runtimePuzzle)) : null;
    this.buffer = [];
    this.clicked = [];
    this.startedAt = null;
    this.timer = null;
    this.remaining = 0;
    this.timeLimit = null;
    this.actor = options.actor ?? HBL.getUserActor();
    this.gmPreview = Boolean(options.gmPreview && game.user.isGM);
    this.enforceRole = !this.gmPreview;
    this.finished = false;
    this.outcome = "active";
    this.outcomeReason = null;
    this._closeHookFired = false;
    this.resetUsed = false;
    this.claimedSequenceIds = new Set();
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "hbl-player",
      title: "Hexcode Breach",
      template: `modules/${HBL_ID}/templates/player-breach.hbs`,
      width: 760,
      height: "auto",
      resizable: true,
      classes: ["hbl", "hbl-player"]
    });
  }

  async getData() {
    if (this.enforceRole && !HBL.isNetrunner(this.actor)) {
      const puzzle = this.puzzle ?? (this.puzzleId
        ? await HBL.getPuzzle(this.puzzleId, { scope: this.puzzleScope, sceneId: this.sourceSceneId })
        : null);
      await HBL.postRoleDenied(this.actor, puzzle);
      setTimeout(() => this.close(), 0);
      return { blocked: true };
    }

    // Normal entry points prepare this snapshot before rendering. Keep a small
    // compatibility fallback for direct/internal construction. The snapshot is
    // created once and is never regenerated by getData()/rerenders.
    if (!this.puzzle) {
      let loaded = null;
      if (this.puzzleId) {
        loaded = await HBL.getPuzzle(this.puzzleId, { scope: this.puzzleScope, sceneId: this.sourceSceneId });
      } else {
        const scenePuzzles = await HBL.getScenePuzzles();
        loaded = Object.values(scenePuzzles)[0] ?? null;
        if (!loaded) {
          const worldPuzzles = await HBL.getWorldPuzzles();
          loaded = Object.values(worldPuzzles)[0] ?? null;
        }
      }

      if (!loaded) {
        ui.notifications.warn("Hexcode Breach puzzle could not be loaded.");
        setTimeout(() => this.close(), 0);
        return { blocked: true };
      }

      this.puzzle = await HBL.prepareRuntimePuzzle(loaded);
      this.puzzleId = this.puzzle.id;
      this.puzzleScope = this.puzzle.storageScope;
    }

    if (this.timeLimit === null) {
      this.timeLimit = Number(this.puzzle.timerSeconds) || 0;
      this.remaining = this.timeLimit;
    }

    const matrixRows = this.puzzle.matrix.map((row, r) => row.map((value, c) => ({
      value,
      r,
      c,
      key: `${r}-${c}`,
      clicked: this.clicked.some(cell => cell.r === r && cell.c === c),
      allowed: this.isAllowed(r, c)
    })));

    const solvedCount = this.puzzle.sequences.filter(sequence => sequence.solved).length;
    return {
      blocked: false,
      puzzle: this.puzzle,
      matrixRows,
      buffer: Array.from({ length: this.puzzle.bufferSize }, (_, index) =>
        this.buffer[index] ?? ""
      ),
      remaining: this.remaining,
      timerDisplay: this.puzzle.timerSeconds ? this.remaining : "∞",
      timerStarted: Boolean(this.startedAt),
      actorName: this.actor?.name ?? "No actor selected",
      isNetrunner: HBL.isNetrunner(this.actor),
      gmPreview: this.gmPreview,
      solvedCount,
      canComplete: solvedCount > 0,
      resetUsed: this.resetUsed,
      resetAvailable: Boolean(this.startedAt && !this.resetUsed && !this.finished),
      resetLabel: this.resetUsed ? "Reset Used" : "Emergency Reset (1)"
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    // Deliberately restored to the proven v1.0.5 interaction shape: one normal
    // Foundry click handler, one authoritative isAllowed() check, and normal
    // Application renders. Portable/reward systems do not manage matrix DOM.
    html.find(".hbl-cell").on("click", event => this.onCellClick(event));
    html.find("[data-action='clear']").on("click", () => this.resetRun());
    html.find("[data-action='complete']").on("click", () => {
      if (!this.puzzle.sequences.some(sequence => sequence.solved)) {
        return ui.notifications.warn("Crack at least one sequence before completing the breach.");
      }
      return this.finishRun("Operator completed breach");
    });
    html.find("[data-action='close']").on("click", () => this.close());
  }

  startTimer() {
    if (this.startedAt || this.finished) return;
    this.timeLimit = Number(this.puzzle.timerSeconds) || 0;
    this.remaining = this.timeLimit;
    this.startedAt = Date.now();
    this.element.find(".hbl-timer-state").text("ACTIVE");
    this.beginCountdown();

    // Chat is observability, not path state. Never make the next legal matrix
    // click wait for a ChatMessage write.
    void HBL.postProgress(
      this.puzzle,
      `<p><b>${hblEsc(game.user.name)}</b> started a breach${this.actor ? ` as <b>${hblEsc(this.actor.name)}</b>` : ""}.</p>`,
      { speaker: ChatMessage.getSpeaker({ actor: this.actor }) }
    ).catch(err => console.warn(`${HBL_ID} | Could not post breach-start progress`, err));
  }

  beginCountdown() {
    this.stopTimer();
    if (!this.timeLimit) return;
    const startedAt = this.startedAt;
    const limit = this.timeLimit;
    this.timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      this.remaining = Math.max(0, limit - elapsed);
      this.element.find(".hbl-timer").text(this.remaining);
      if (this.remaining <= 0) this.finishRun("Timer expired");
    }, 250);
  }

  isAllowed(r, c) {
    if (this.clicked.some(cell => cell.r === r && cell.c === c)) return false;
    if (!this.clicked.length) return r === 0;
    const last = this.clicked[this.clicked.length - 1];
    return this.clicked.length % 2 === 1 ? c === last.c : r === last.r;
  }

  async onCellClick(event) {
    if (this.finished) return;
    const r = Number(event.currentTarget.dataset.r);
    const c = Number(event.currentTarget.dataset.c);
    if (!this.isAllowed(r, c)) {
      return ui.notifications.warn("Invalid breach path. First pick must be top row, then alternate column/row.");
    }

    if (!this.startedAt) this.startTimer();

    const value = this.puzzle.matrix[r][c];
    this.clicked.push({ r, c, value });
    this.buffer.push(value);

    // Sequence detection is synchronous over the real fixed-capacity buffer.
    // Substring matching naturally supports overlap: 1C 55 1C cracks both
    // 1C 55 and 55 1C without granting extra buffer slots.
    const newlySolved = this.checkSequences();
    const allSolved = this.puzzle.sequences.every(sequence => sequence.solved);
    const bufferFilled = this.buffer.length >= this.puzzle.bufferSize;

    if (!allSolved && !bufferFilled) this.render();
    for (const sequence of newlySolved) void this.settleSequenceReward(sequence);

    if (this.finished) return;
    if (allSolved) return this.success("All sequences cracked");
    if (bufferFilled) return this.finishRun("Buffer filled");
    return this;
  }

  bufferContains(code) {
    if (!code?.length) return false;
    const buffer = this.buffer;
    outer: for (let i = 0; i <= buffer.length - code.length; i++) {
      for (let j = 0; j < code.length; j++) {
        if (buffer[i + j] !== code[j]) continue outer;
      }
      return true;
    }
    return false;
  }

  checkSequences() {
    const newlySolved = [];
    for (const sequence of this.puzzle.sequences) {
      if (!sequence.solved && this.bufferContains(sequence.code)) {
        sequence.solved = true;
        newlySolved.push(sequence);
        ui.notifications.info(`Sequence cracked: ${sequence.label}`);
        void HBL.postProgress(
          this.puzzle,
          `<p>Sequence cracked: <b>${hblEsc(sequence.label)}</b> <code>${sequence.code.map(hblEsc).join(" ")}</code></p>`,
          { speaker: ChatMessage.getSpeaker({ actor: this.actor }) }
        ).catch(err => console.warn(`${HBL_ID} | Could not post sequence progress`, err));
      }
    }
    return newlySolved;
  }

  async settleSequenceReward(sequence) {
    try {
      const rewardHtml = await HBL.grantSequenceRewards(this.actor, sequence, this.puzzle, {
        gmPreview: this.gmPreview,
        sceneId: this.sourceSceneId
      });
      if (sequence.rewardGranted) this.claimedSequenceIds.add(sequence.id);
      if (!rewardHtml) return;
      await HBL.postProgress(
        this.puzzle,
        `<p><b>Payload resolved — ${hblEsc(sequence.label)}</b></p>${rewardHtml}`,
        { speaker: ChatMessage.getSpeaker({ actor: this.actor }) }
      );
    } catch (err) {
      console.error(`${HBL_ID} | Reward settlement failed for ${sequence?.label || sequence?.id || "sequence"}`, err);
      ui.notifications.warn(`Sequence cracked, but its payload could not be settled. Check F12 or retry after the GM is connected.`);
    }
  }

  async finishRun(reason = "Breach ended") {
    if (this.finished) return;
    return this.puzzle.sequences.some(sequence => sequence.solved) ? this.success(reason) : this.fail(reason);
  }

  async success(reason = "Breach complete") {
    if (this.finished) return;
    this.finished = true;
    this.stopTimer();
    const solved = this.puzzle.sequences.filter(sequence => sequence.solved);
    const missed = this.puzzle.sequences.filter(sequence => !sequence.solved);
    const fullSuccess = solved.length === this.puzzle.sequences.length;
    this.outcome = fullSuccess ? "success" : "partial";
    this.outcomeReason = reason;
    const solvedList = solved.map(sequence => `<li><b>${hblEsc(sequence.label)}</b>: <code>${sequence.code.map(hblEsc).join(" ")}</code></li>`).join("");
    const missedList = missed.length
      ? `<p class="hbl-muted">Unresolved: ${missed.map(sequence => hblEsc(sequence.label)).join(", ")}</p>`
      : "";
    const resultLabel = fullSuccess ? "BREACH SUCCESSFUL" : "BREACH PARTIAL SUCCESS";
    await HBL.postProgress(
      this.puzzle,
      `<p class="hbl-success"><b>${resultLabel}</b> — ${hblEsc(reason)}</p><p>Buffer: <code>${this.buffer.map(hblEsc).join(" ")}</code></p><ul>${solvedList}</ul>${missedList}`,
      { speaker: ChatMessage.getSpeaker({ actor: this.actor }) }
    );
    if (fullSuccess) {
      ui.notifications.info(`Breach successful: all ${solved.length} sequence${solved.length === 1 ? "" : "s"} cracked.`);
    } else {
      ui.notifications.info(`Partial breach success: ${solved.length} of ${this.puzzle.sequences.length} sequences cracked.`);
    }
    return this.close();
  }

  async fail(reason = "Breach failed") {
    if (this.finished) return;
    this.finished = true;
    this.outcome = "failure";
    this.outcomeReason = reason;
    this.stopTimer();
    await HBL.postProgress(
      this.puzzle,
      `<p class="hbl-fail"><b>BREACH FAILED:</b> ${hblEsc(reason)}</p><p>Buffer: <code>${this.buffer.map(hblEsc).join(" ")}</code></p>`,
      { speaker: ChatMessage.getSpeaker({ actor: this.actor }) }
    );
    ui.notifications.warn(`Breach failed: ${reason}`);
    return this.close();
  }

  async resetRun() {
    if (this.finished) return;
    if (!this.startedAt) return ui.notifications.warn("The emergency reset becomes available after the first hex is selected.");
    if (this.resetUsed) return ui.notifications.warn("The one permitted emergency reset has already been used.");

    const previousRemaining = this.remaining;
    this.resetUsed = true;
    this.stopTimer();
    this.buffer = [];
    this.clicked = [];
    this.puzzle.matrix = HBL.generateSolvableMatrix(this.puzzle);
    this.puzzle.sequences = this.puzzle.sequences.map(sequence => ({
      ...sequence,
      rewardGranted: this.claimedSequenceIds.has(sequence.id)
    }));

    if (this.puzzle.timerSeconds) {
      this.timeLimit = Math.max(1, Math.floor(previousRemaining / 2));
      this.remaining = this.timeLimit;
      this.startedAt = Date.now();
      this.beginCountdown();
    } else {
      this.timeLimit = 0;
      this.remaining = 0;
      this.startedAt = Date.now();
    }

    const solvedCount = this.puzzle.sequences.filter(sequence => sequence.solved).length;
    const timerText = this.puzzle.timerSeconds
      ? `The remaining clock was halved from ${previousRemaining}s to ${this.timeLimit}s.`
      : "This breach has no timer, but its single reset is now spent.";
    await HBL.postProgress(
      this.puzzle,
      `<p class="hbl-reset-log"><b>EMERGENCY RESET USED</b> by ${hblEsc(this.actor?.name || game.user.name)}.</p><p>${hblEsc(timerText)}</p><p>Buffer and matrix were reset. ${solvedCount ? `${solvedCount} previously cracked sequence${solvedCount === 1 ? " remains" : "s remain"} secured.` : "No sequence had been secured."}</p>`,
      { force: true, speaker: ChatMessage.getSpeaker({ actor: this.actor }) }
    );
    ui.notifications.warn(`Emergency reset used. ${timerText}`);
    return this.render();
  }

  stopTimer() {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
  }

  async close(options) {
    this.stopTimer();

    // Manual closure is not a failure. If at least one sequence was already
    // secured, expose it as a partial result; otherwise expose an abort.
    if (this.outcome === "active") {
      const solvedCount = this.puzzle?.sequences?.filter(sequence => sequence.solved).length ?? 0;
      this.outcome = solvedCount > 0 ? "partial" : "aborted";
      this.outcomeReason = solvedCount > 0
        ? "Operator closed the breach after securing one or more sequences"
        : "Operator closed the breach before securing a sequence";
    }

    const result = await super.close(options);

    // Fire exactly once, after the Foundry window has actually closed. The app
    // remains the first argument for compatibility; resultData is the preferred
    // CitiNet/companion-module contract.
    if (!this._closeHookFired) {
      this._closeHookFired = true;
      const sequences = this.puzzle?.sequences ?? [];
      const solved = sequences.filter(sequence => sequence.solved);
      const resultData = {
        outcome: this.outcome,
        reason: this.outcomeReason,
        puzzleId: this.puzzleId ?? this.puzzle?.id ?? null,
        puzzleName: this.puzzle?.name ?? null,
        puzzleScope: this.puzzleScope ?? this.puzzle?.storageScope ?? "scene",
        sceneId: this.sourceSceneId,
        actorId: this.actor?.id ?? null,
        actorUuid: this.actor?.uuid ?? null,
        solvedCount: solved.length,
        totalSequences: sequences.length,
        solvedSequenceIds: solved.map(sequence => sequence.id),
        gmPreview: this.gmPreview
      };
      Hooks.callAll("closeHBLPlayerApp", this, resultData);
    }

    return result;
  }
}

function hblExposeApi() {
  const module = game.modules.get(HBL_ID);
  if (module) module.api = HBL.api;
  window.HexcodeBreachLite = HBL.api;
  game.hexcodebreach = async context => game.modules.get(HBL_ID)?.api?.openBound(context);
}

Hooks.once("init", () => {
  game.settings.register(HBL_ID, HBL_SETTING_WORLD_PUZZLES, {
    name: "Portable Hexcode Breach Puzzle Library",
    hint: "Hidden world-level storage used by portable Hexcode Breach puzzles.",
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(HBL_ID, HBL_SETTING_REWARD_CLAIMS, {
    name: "Hexcode Breach One-Time Reward Claims",
    hint: "Hidden GM-authoritative ledger preventing one-time breach rewards from being farmed repeatedly.",
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(HBL_ID, "enableDebug", {
    name: "Enable Debug Logging",
    hint: "Log Hexcode Breach Lite debug information to the console.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
  // Expose the public API during init as well as ready. This makes the helper
  // resilient to module/Macro execution ordering during Foundry startup.
  hblExposeApi();
});

Hooks.once("ready", () => {
  hblExposeApi();

  game.socket.on(HBL_SOCKET, async message => {
    if (!message || typeof message !== "object") return;

    if (message.type === "push-puzzle-response" && message.targetUserId === game.user.id) {
      const pending = HBL.pendingPushRequests.get(message.requestId);
      if (!pending) return;
      window.clearTimeout(pending.timeout);
      HBL.pendingPushRequests.delete(message.requestId);
      pending.resolve(message.result || { ok: false, message: "The pushed breach was not acknowledged." });
      return;
    }

    if (message.type === "push-puzzle-request" && message.targetUserId === game.user.id) {
      const result = await HBL.processPushPuzzleRequest(message);
      if (!result) return;
      game.socket.emit(HBL_SOCKET, {
        type: "push-puzzle-response",
        requestId: message.requestId,
        senderId: game.user.id,
        targetUserId: message.senderId,
        result
      });
      return;
    }

    if (message.type === "reward-response" && message.targetUserId === game.user.id) {
      const pending = HBL.pendingRewardRequests.get(message.requestId);
      if (!pending) return;
      window.clearTimeout(pending.timeout);
      HBL.pendingRewardRequests.delete(message.requestId);
      pending.resolve(message.result || { ok: false, html: "" });
      return;
    }

    if (message.type === "reward-request" && game.user.isGM && message.targetGMId === game.user.id) {
      const result = await HBL.enqueueRewardRequest(() => HBL.processSequenceRewardRequest(message.payload || {}));
      game.socket.emit(HBL_SOCKET, {
        type: "reward-response",
        requestId: message.requestId,
        targetUserId: message.senderId,
        result
      });
    }
  });

  console.log(`${HBL_ID} | Ready. API: HexcodeBreachLite.openGM(), HexcodeBreachLite.openPuzzle(id), HexcodeBreachLite.openPushDialog(), game.hexcodebreach(context)`);
});

Hooks.on("getSceneControlButtons", controls => {
  if (!game.user.isGM) return;
  const tokenControls = controls.find(control => control.name === "token");
  if (!tokenControls) return;
  tokenControls.tools.push({
    name: "hbl-open-gm",
    title: "Hexcode Breach Lite",
    icon: "fas fa-code",
    button: true,
    onClick: () => HBL.api.openGM()
  });
});


function hblRefreshOpenGMWindows(sceneId = null) {
  for (const app of Object.values(ui?.windows || {})) {
    if (!(app instanceof HBLGMConfigApp)) continue;
    const activeSceneId = HBL.getScene()?.id ?? null;
    if (sceneId && activeSceneId && sceneId !== activeSceneId) continue;
    app.render(false);
  }
}

Hooks.on("deleteTile", tile => {
  hblRefreshOpenGMWindows(tile?.parent?.id ?? tile?.parent?.parent?.id ?? null);
});

Hooks.on("updateTile", (tile, changes) => {
  if (changes?.flags?.[HBL_ID] !== undefined) {
    hblRefreshOpenGMWindows(tile?.parent?.id ?? null);
  }
});
