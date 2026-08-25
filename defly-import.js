/**
 * Convert Defly map text into the target map-editor object.
 *
 * @param {string} deflyText Raw contents of a Defly .txt map.
 * @param {number|object} [scale=100] Spacing percentage, or conversion options.
 * @param {number} [spawnProtectionSize=500] Target spawn-protection square size.
 * @returns {object} A JSON-serializable target map object.
 */
function convertDeflyMap(deflyText, scale = 100, spawnProtectionSize = 500) {
  const SOURCE_SPAWN_SIZE = 9;
  const options = scale && typeof scale === "object" ? scale : {};
  const BASE_COORDINATE_SCALE = Number(options.unitSize ?? options.coordinateScale ?? 32);
  const TARGET_TOWER_RADIUS = Number(options.towerClearance ?? options.towerRadius ?? 35.2);
  const TARGET_BOMB_RADIUS = Number(options.bombClearance ?? options.bombRadius ?? 250);
  const TARGET_BOUNDARY_MARGIN = Number(options.boundaryPadding ?? options.boundaryMargin ?? 1);

  if (typeof deflyText !== "string") {
    throw new TypeError("deflyText must be a string.");
  }

  scale = Number(options.spacingPercent ?? options.scale ?? (typeof scale === "number" ? scale : 100));
  spawnProtectionSize = Number(options.spawnProtectionSize ?? spawnProtectionSize);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error("Object spacing must be a positive number.");
  }
  if (!Number.isFinite(spawnProtectionSize) || spawnProtectionSize <= 0) {
    throw new Error("Spawn protection size must be a positive number.");
  }
  if (!Number.isFinite(BASE_COORDINATE_SCALE) || BASE_COORDINATE_SCALE <= 0) {
    throw new Error("Unit size must be a positive number.");
  }
  if (!Number.isFinite(TARGET_TOWER_RADIUS) || TARGET_TOWER_RADIUS < 0) {
    throw new Error("Tower clearance cannot be negative.");
  }
  if (!Number.isFinite(TARGET_BOMB_RADIUS) || TARGET_BOMB_RADIUS < 0) {
    throw new Error("Bomb clearance cannot be negative.");
  }
  if (!Number.isFinite(TARGET_BOUNDARY_MARGIN) || TARGET_BOUNDARY_MARGIN < 0) {
    throw new Error("Boundary padding cannot be negative.");
  }

  const source = {
    width: null,
    height: null,
    bombSites: new Map(),
    spawns: new Map(),
    towers: new Map(),
    links: [],
    zones: [],
  };

  const number = (token, lineNumber, name) => {
    const value = Number(token);
    if (!Number.isFinite(value)) {
      throw new Error(`Line ${lineNumber}: ${name} must be a number; got ${JSON.stringify(token)}.`);
    }
    return value;
  };

  const integer = (token, lineNumber, name) => {
    const value = number(token, lineNumber, name);
    if (!Number.isInteger(value)) {
      throw new Error(`Line ${lineNumber}: ${name} must be an integer; got ${JSON.stringify(token)}.`);
    }
    return value;
  };

  const checkFieldCount = (parts, lineNumber, minimum, maximum = minimum) => {
    if (parts.length >= minimum && parts.length <= maximum) return;
    const expected = minimum === maximum ? String(minimum) : `${minimum}-${maximum}`;
    throw new Error(
      `Line ${lineNumber}: ${JSON.stringify(parts[0])} expects ${expected} fields; got ${parts.length}.`,
    );
  };

  const deflyColorToTeam = (color) => ({ 2: 0, 3: 1 })[color] ?? -1;
  const edgeKey = (start, end) => `${Math.min(start, end)}:${Math.max(start, end)}`;

  const lines = deflyText.replace(/^\uFEFF/, "").split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) return;

    const parts = line.split(/\s+/);
    const directive = parts[0];

    switch (directive) {
      case "MAP_WIDTH":
        checkFieldCount(parts, lineNumber, 2);
        source.width = number(parts[1], lineNumber, "map width");
        break;

      case "MAP_HEIGHT":
        checkFieldCount(parts, lineNumber, 2);
        source.height = number(parts[1], lineNumber, "map height");
        break;

      case "MAP_SHAPE":
        checkFieldCount(parts, lineNumber, 2);
        integer(parts[1], lineNumber, "map shape");
        break;

      case "KOTH":
        checkFieldCount(parts, lineNumber, 5);
        number(parts[1], lineNumber, "KOTH x1");
        number(parts[2], lineNumber, "KOTH y1");
        number(parts[3], lineNumber, "KOTH x2");
        number(parts[4], lineNumber, "KOTH y2");
        break;

      case "t": { // Bomb site: t <0=A|1=B> <x> <y> [setting]
        checkFieldCount(parts, lineNumber, 4, 5);
        const siteId = integer(parts[1], lineNumber, "bomb-site ID");
        if (siteId !== 0 && siteId !== 1) {
          throw new Error(`Line ${lineNumber}: bomb-site ID must be 0 (A) or 1 (B).`);
        }
        if (source.bombSites.has(siteId)) {
          throw new Error(`Line ${lineNumber}: duplicate bomb-site ID ${siteId}.`);
        }
        source.bombSites.set(siteId, {
          x: number(parts[2], lineNumber, "bomb-site x"),
          y: number(parts[3], lineNumber, "bomb-site y"),
        });
        if (parts.length === 5) integer(parts[4], lineNumber, "bomb-site setting");
        break;
      }

      case "s": { // Spawn top-left: s <1|2> <x> <y> [rotation]
        checkFieldCount(parts, lineNumber, 4, 5);
        const sourceTeam = integer(parts[1], lineNumber, "spawn team");
        if (sourceTeam !== 1 && sourceTeam !== 2) {
          throw new Error(`Line ${lineNumber}: spawn team must be 1 or 2.`);
        }
        const teamId = sourceTeam - 1;
        if (source.spawns.has(teamId)) {
          throw new Error(`Line ${lineNumber}: duplicate spawn for team ${sourceTeam}.`);
        }
        const half = SOURCE_SPAWN_SIZE / 2;
        source.spawns.set(teamId, {
          x: number(parts[2], lineNumber, "spawn x") + half,
          y: number(parts[3], lineNumber, "spawn y") + half,
        });
        if (parts.length === 5) integer(parts[4], lineNumber, "spawn rotation");
        break;
      }

      case "d": { // Tower: d <id> <x> <y> [Defly color]
        checkFieldCount(parts, lineNumber, 4, 5);
        const id = integer(parts[1], lineNumber, "tower ID");
        if (source.towers.has(id)) {
          throw new Error(`Line ${lineNumber}: duplicate tower ID ${id}.`);
        }
        const color = parts.length === 5 ? integer(parts[4], lineNumber, "tower color") : 1;
        source.towers.set(id, {
          id,
          teamId: deflyColorToTeam(color),
          position: {
            x: number(parts[2], lineNumber, "tower x"),
            y: number(parts[3], lineNumber, "tower y"),
          },
        });
        break;
      }

      case "l": // Wall: l <tower id> <tower id>
        checkFieldCount(parts, lineNumber, 3);
        source.links.push([
          integer(parts[1], lineNumber, "wall start tower"),
          integer(parts[2], lineNumber, "wall end tower"),
        ]);
        break;

      case "z": { // Defly-only shaded zone, represented by an existing wall ring.
        if (parts.length < 4) {
          throw new Error(`Line ${lineNumber}: a shaded zone needs at least three tower IDs.`);
        }
        const zone = parts.slice(1).map((token) => integer(token, lineNumber, "shaded-zone tower ID"));
        if (new Set(zone).size !== zone.length) {
          throw new Error(`Line ${lineNumber}: a shaded zone repeats a tower ID.`);
        }
        source.zones.push(zone);
        break;
      }

      default:
        throw new Error(`Line ${lineNumber}: unsupported Defly directive ${JSON.stringify(directive)}.`);
    }
  });

  if (!Number.isFinite(source.width) || !Number.isFinite(source.height)) {
    throw new Error("The source must define MAP_WIDTH and MAP_HEIGHT.");
  }
  if (source.width <= 0 || source.height <= 0) {
    throw new Error("MAP_WIDTH and MAP_HEIGHT must be positive.");
  }
  if (source.spawns.size !== 2 || !source.spawns.has(0) || !source.spawns.has(1)) {
    throw new Error("The target needs exactly one team-1 and team-2 spawn.");
  }
  if (source.towers.size === 0) {
    throw new Error("The source does not contain any towers.");
  }

  source.links.forEach(([start, end]) => {
    const missing = [start, end].filter((id) => !source.towers.has(id));
    if (missing.length) {
      throw new Error(`Wall ${start}-${end} refers to missing tower ID(s): ${missing.join(", ")}.`);
    }
  });

  const sourceEdges = new Set(source.links.map(([start, end]) => edgeKey(start, end)));
  source.zones.forEach((zone, zoneIndex) => {
    const missing = zone.filter((id) => !source.towers.has(id));
    if (missing.length) {
      throw new Error(`Shaded zone ${zoneIndex + 1} refers to missing tower ID(s): ${missing.join(", ")}.`);
    }

    const missingEdges = [];
    zone.forEach((start, index) => {
      const end = zone[(index + 1) % zone.length];
      if (!sourceEdges.has(edgeKey(start, end))) missingEdges.push(`${start}-${end}`);
    });
    if (missingEdges.length) {
      throw new Error(`Shaded zone ${zoneIndex + 1} is not enclosed; missing wall(s): ${missingEdges.join(", ")}.`);
    }
  });

  const seenEdges = new Set();
  const links = [];
  source.links.forEach(([start, end]) => {
    if (start === end) return;
    const key = edgeKey(start, end);
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    links.push([start, end]);
  });

  const coordinateScale = BASE_COORDINATE_SCALE * scale / 100;
  const sourceWidth = source.width * coordinateScale;
  const sourceHeight = source.height * coordinateScale;
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;

  const paddedObjects = [];
  source.towers.forEach((tower) => paddedObjects.push([tower.position, TARGET_TOWER_RADIUS]));
  source.spawns.forEach((position) => paddedObjects.push([position, spawnProtectionSize / 2]));
  source.bombSites.forEach((position) => paddedObjects.push([position, TARGET_BOMB_RADIUS]));

  paddedObjects.forEach(([position, objectRadius]) => {
    const x = position.x * coordinateScale;
    const y = position.y * coordinateScale;
    const radius = objectRadius + TARGET_BOUNDARY_MARGIN;
    left = Math.max(left, radius - x);
    right = Math.max(right, x + radius - sourceWidth);
    top = Math.max(top, radius - y);
    bottom = Math.max(bottom, y + radius - sourceHeight);
  });

  const transform = (position) => ({
    x: left + position.x * coordinateScale,
    y: top + position.y * coordinateScale,
  });

  const cleanNumber = (value) => {
    const rounded = Math.round((value + Number.EPSILON) * 1000) / 1000;
    return Object.is(rounded, -0) || Math.abs(rounded) < 0.0005 ? 0 : rounded;
  };

  const towerPositions = new Map();
  source.towers.forEach((tower, id) => towerPositions.set(id, transform(tower.position)));

  const walls = links.map(([start, end]) => {
    const startTeam = source.towers.get(start).teamId;
    const endTeam = source.towers.get(end).teamId;
    if (startTeam !== endTeam) {
      throw new Error(
        `Wall ${start}-${end} connects towers on different teams; the target format cannot represent it.`,
      );
    }
    return { t1: start, t2: end, team_id: startTeam };
  });

  const width = left + sourceWidth + right;
  const height = top + sourceHeight + bottom;

  return {
    spawn_protection_size: cleanNumber(spawnProtectionSize),
    map_boundaries: [
      { x: 0, y: 0 },
      { x: cleanNumber(width), y: 0 },
      { x: cleanNumber(width), y: cleanNumber(height) },
      { x: 0, y: cleanNumber(height) },
    ],
    spawn_points: [...source.spawns.entries()]
      .sort(([a], [b]) => a - b)
      .map(([teamId, position]) => {
        const target = transform(position);
        return { team_id: teamId, x: cleanNumber(target.x), y: cleanNumber(target.y) };
      }),
    bomb_sites: [...source.bombSites.entries()]
      .sort(([a], [b]) => a - b)
      .map(([siteId, position]) => {
        const target = transform(position);
        return {
          site_letter: String.fromCharCode("A".charCodeAt(0) + siteId),
          x: cleanNumber(target.x),
          y: cleanNumber(target.y),
        };
      }),
    towers: [...source.towers.entries()]
      .sort(([a], [b]) => a - b)
      .map(([id, tower]) => {
        const position = towerPositions.get(id);
        return {
          id,
          team_id: tower.teamId,
          x: cleanNumber(position.x),
          y: cleanNumber(position.y),
          health: 4,
          is_invincible: false,
        };
      }),
    walls,
  };
}

// CommonJS/Node and normal browser <script> support. No CLI or file handling.
if (typeof module !== "undefined" && module.exports) module.exports = convertDeflyMap;
if (typeof window !== "undefined") window.convertDeflyMap = convertDeflyMap;
