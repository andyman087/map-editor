(function attachMapHoleGeometry(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MapHoleGeometry = api;
}(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const EPSILON = 0.0001;
  const BASE_CONNECTIVITY_CELL_SIZE = 32;
  const MAX_CONNECTIVITY_CELLS = 262144;

  function isFinitePoint(point) {
    return Boolean(point) && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y));
  }

  function pointsEqual(a, b, epsilon = EPSILON) {
    return Math.abs(Number(a.x) - Number(b.x)) <= epsilon
      && Math.abs(Number(a.y) - Number(b.y)) <= epsilon;
  }

  function distinctPointCount(points) {
    const distinct = [];
    (points || []).forEach((point) => {
      if (isFinitePoint(point) && !distinct.some((existing) => pointsEqual(existing, point))) distinct.push(point);
    });
    return distinct.length;
  }

  function polygonArea(points) {
    if (!Array.isArray(points) || points.length < 3) return 0;
    let twiceArea = 0;
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      twiceArea += Number(current.x) * Number(next.y) - Number(next.x) * Number(current.y);
    }
    return twiceArea / 2;
  }

  function cross(a, b, c) {
    return (Number(b.x) - Number(a.x)) * (Number(c.y) - Number(a.y))
      - (Number(b.y) - Number(a.y)) * (Number(c.x) - Number(a.x));
  }

  function pointOnSegment(point, a, b, epsilon = EPSILON) {
    if (Math.abs(cross(a, b, point)) > epsilon) return false;
    return Number(point.x) >= Math.min(Number(a.x), Number(b.x)) - epsilon
      && Number(point.x) <= Math.max(Number(a.x), Number(b.x)) + epsilon
      && Number(point.y) >= Math.min(Number(a.y), Number(b.y)) - epsilon
      && Number(point.y) <= Math.max(Number(a.y), Number(b.y)) + epsilon;
  }

  function pointOnPolygonEdge(point, points) {
    if (!Array.isArray(points) || points.length < 2) return false;
    for (let index = 0; index < points.length; index += 1) {
      if (pointOnSegment(point, points[index], points[(index + 1) % points.length])) return true;
    }
    return false;
  }

  function pointInPolygon(point, points, includeEdge = false) {
    if (!Array.isArray(points) || points.length < 3 || !isFinitePoint(point)) return false;
    if (pointOnPolygonEdge(point, points)) return includeEdge;
    let inside = false;
    for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
      const currentPoint = points[index];
      const previousPoint = points[previous];
      const crossesRay = (Number(currentPoint.y) > Number(point.y)) !== (Number(previousPoint.y) > Number(point.y));
      if (!crossesRay) continue;
      const xAtY = ((Number(previousPoint.x) - Number(currentPoint.x))
        * (Number(point.y) - Number(currentPoint.y)))
        / (Number(previousPoint.y) - Number(currentPoint.y)) + Number(currentPoint.x);
      if (Number(point.x) < xAtY) inside = !inside;
    }
    return inside;
  }

  function segmentsIntersectOrTouch(a, b, c, d) {
    const abC = cross(a, b, c);
    const abD = cross(a, b, d);
    const cdA = cross(c, d, a);
    const cdB = cross(c, d, b);
    if (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON))
      && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) return true;
    return Math.abs(abC) <= EPSILON && pointOnSegment(c, a, b)
      || Math.abs(abD) <= EPSILON && pointOnSegment(d, a, b)
      || Math.abs(cdA) <= EPSILON && pointOnSegment(a, c, d)
      || Math.abs(cdB) <= EPSILON && pointOnSegment(b, c, d);
  }

  function polygonSelfIntersects(points) {
    if (!Array.isArray(points) || points.length < 3) return false;
    for (let first = 0; first < points.length; first += 1) {
      const firstNext = (first + 1) % points.length;
      for (let second = first + 1; second < points.length; second += 1) {
        const secondNext = (second + 1) % points.length;
        if (first === second || firstNext === second || secondNext === first) continue;
        if (segmentsIntersectOrTouch(points[first], points[firstNext], points[second], points[secondNext])) return true;
      }
    }
    return false;
  }

  function polygonsTouchOrOverlap(first, second) {
    if (!Array.isArray(first) || !Array.isArray(second) || first.length < 3 || second.length < 3) return false;
    for (let a = 0; a < first.length; a += 1) {
      for (let b = 0; b < second.length; b += 1) {
        if (segmentsIntersectOrTouch(first[a], first[(a + 1) % first.length], second[b], second[(b + 1) % second.length])) return true;
      }
    }
    return pointInPolygon(first[0], second, true) || pointInPolygon(second[0], first, true);
  }

  function polygonStrictlyInsideBoundary(points, boundary) {
    if (!Array.isArray(points) || points.length < 3 || !Array.isArray(boundary) || boundary.length < 3) return false;
    if (!points.every((point) => pointInPolygon(point, boundary, false))) return false;
    for (let holeEdge = 0; holeEdge < points.length; holeEdge += 1) {
      for (let boundaryEdge = 0; boundaryEdge < boundary.length; boundaryEdge += 1) {
        if (segmentsIntersectOrTouch(
          points[holeEdge],
          points[(holeEdge + 1) % points.length],
          boundary[boundaryEdge],
          boundary[(boundaryEdge + 1) % boundary.length],
        )) return false;
      }
    }
    return true;
  }

  function pointToSegmentDistance(point, a, b) {
    const dx = Number(b.x) - Number(a.x);
    const dy = Number(b.y) - Number(a.y);
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= EPSILON * EPSILON) return Math.hypot(Number(point.x) - Number(a.x), Number(point.y) - Number(a.y));
    const projection = Math.max(0, Math.min(1,
      ((Number(point.x) - Number(a.x)) * dx + (Number(point.y) - Number(a.y)) * dy) / lengthSquared));
    const closestX = Number(a.x) + projection * dx;
    const closestY = Number(a.y) + projection * dy;
    return Math.hypot(Number(point.x) - closestX, Number(point.y) - closestY);
  }

  function circleOverlapsPolygon(center, radius, points) {
    if (!Array.isArray(points) || points.length < 3) return false;
    if (pointInPolygon(center, points, true)) return true;
    for (let index = 0; index < points.length; index += 1) {
      if (pointToSegmentDistance(center, points[index], points[(index + 1) % points.length]) <= Number(radius) + EPSILON) return true;
    }
    return false;
  }

  function polygonOf(hole) {
    return Array.isArray(hole) ? hole : Array.isArray(hole?.points) ? hole.points : [];
  }

  function findContainingHoleIndex(point, holes) {
    for (let index = 0; index < (holes || []).length; index += 1) {
      if (pointInPolygon(point, polygonOf(holes[index]), true)) return index;
    }
    return -1;
  }

  function findCircleOverlappingHoleIndex(center, radius, holes) {
    for (let index = 0; index < (holes || []).length; index += 1) {
      if (circleOverlapsPolygon(center, radius, polygonOf(holes[index]))) return index;
    }
    return -1;
  }

  function parseMapHoles(value, createUid = (prefix) => `${prefix}_${Math.random()}`) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error("map_holes must be an array.");
    return value.map((rawHole, holeIndex) => {
      if (!Array.isArray(rawHole)) throw new Error(`map_holes[${holeIndex}] must be an array of points.`);
      return {
        uid: createUid("hole"),
        points: rawHole.map((point, pointIndex) => {
          if (!point || typeof point !== "object" || Array.isArray(point)) {
            throw new Error(`map_holes[${holeIndex}][${pointIndex}] must be a point object.`);
          }
          const x = Number(point.x);
          const y = Number(point.y);
          if (!Number.isFinite(x)) throw new Error(`map_holes[${holeIndex}][${pointIndex}].x must be a number.`);
          if (!Number.isFinite(y)) throw new Error(`map_holes[${holeIndex}][${pointIndex}].y must be a number.`);
          return { uid: createUid("hole_vertex"), x, y };
        }),
      };
    });
  }

  function serializeMapHoles(holes, roundCoordinate = (value) => Number(value)) {
    return (holes || []).map((hole) => polygonOf(hole).map((point) => ({
      x: roundCoordinate(Number(point.x)),
      y: roundCoordinate(Number(point.y)),
    })));
  }

  function addMapHolesToPayload(payload, holes, roundCoordinate = (value) => Number(value)) {
    if ((holes || []).length) payload.map_holes = serializeMapHoles(holes, roundCoordinate);
    else delete payload.map_holes;
    return payload;
  }

  function getConnectivityGrid(boundary, holes) {
    if (!Array.isArray(boundary) || boundary.length < 3) return null;
    const xs = boundary.map((point) => Number(point.x));
    const ys = boundary.map((point) => Number(point.y));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = Math.max(EPSILON, maxX - minX);
    const height = Math.max(EPSILON, maxY - minY);
    let cellSize = BASE_CONNECTIVITY_CELL_SIZE;
    let columns = Math.max(1, Math.ceil(width / cellSize));
    let rows = Math.max(1, Math.ceil(height / cellSize));
    if (columns * rows > MAX_CONNECTIVITY_CELLS) {
      cellSize *= Math.sqrt((columns * rows) / MAX_CONNECTIVITY_CELLS);
      columns = Math.max(1, Math.ceil(width / cellSize));
      rows = Math.max(1, Math.ceil(height / cellSize));
      while (columns * rows > MAX_CONNECTIVITY_CELLS) {
        cellSize *= 1.001;
        columns = Math.max(1, Math.ceil(width / cellSize));
        rows = Math.max(1, Math.ceil(height / cellSize));
      }
    }
    return { minX, minY, width, height, cellSize, columns, rows };
  }

  function holesDisconnectBoundary(boundary, holes) {
    const grid = getConnectivityGrid(boundary, holes);
    if (!grid) return false;
    const polygons = (holes || []).map(polygonOf).filter((points) => points.length >= 3);
    const walkable = new Uint8Array(grid.columns * grid.rows);
    let firstWalkable = -1;
    let walkableCount = 0;
    for (let row = 0; row < grid.rows; row += 1) {
      for (let column = 0; column < grid.columns; column += 1) {
        const point = {
          x: grid.minX + Math.min(grid.width, (column + 0.5) * grid.cellSize),
          y: grid.minY + Math.min(grid.height, (row + 0.5) * grid.cellSize),
        };
        if (!pointInPolygon(point, boundary, true) || polygons.some((polygon) => pointInPolygon(point, polygon, true))) continue;
        const index = row * grid.columns + column;
        walkable[index] = 1;
        walkableCount += 1;
        if (firstWalkable < 0) firstWalkable = index;
      }
    }
    if (walkableCount <= 1) return false;
    const visited = new Uint8Array(walkable.length);
    const queue = new Int32Array(walkableCount);
    let readIndex = 0;
    let writeIndex = 0;
    let reached = 0;
    queue[writeIndex++] = firstWalkable;
    visited[firstWalkable] = 1;
    while (readIndex < writeIndex) {
      const current = queue[readIndex++];
      reached += 1;
      const row = Math.floor(current / grid.columns);
      const column = current % grid.columns;
      const neighbours = [
        column > 0 ? current - 1 : -1,
        column + 1 < grid.columns ? current + 1 : -1,
        row > 0 ? current - grid.columns : -1,
        row + 1 < grid.rows ? current + grid.columns : -1,
      ];
      neighbours.forEach((neighbour) => {
        if (neighbour < 0 || !walkable[neighbour] || visited[neighbour]) return;
        visited[neighbour] = 1;
        queue[writeIndex++] = neighbour;
      });
    }
    return reached !== walkableCount;
  }

  function validateMapHoles(mapState) {
    const issues = [];
    const boundary = Array.isArray(mapState?.map_boundaries) ? mapState.map_boundaries : [];
    const holes = Array.isArray(mapState?.map_holes) ? mapState.map_holes : [];
    const addIssue = (message, holeIndexes = [], entity = null) => issues.push({ message, holeIndexes, entity });
    const validForRelations = new Set();

    holes.forEach((hole, holeIndex) => {
      const points = polygonOf(hole);
      if (!Array.isArray(points) || distinctPointCount(points) < 3) {
        addIssue(`Hole ${holeIndex} must contain at least 3 distinct valid points.`, [holeIndex]);
        return;
      }
      if (polygonSelfIntersects(points)) {
        addIssue(`Hole ${holeIndex} is self-intersecting.`, [holeIndex]);
        return;
      }
      if (Math.abs(polygonArea(points)) <= EPSILON) {
        addIssue(`Hole ${holeIndex} has zero area.`, [holeIndex]);
        return;
      }
      if (!polygonStrictlyInsideBoundary(points, boundary)) {
        addIssue(`Hole ${holeIndex} is outside the boundary polygon.`, [holeIndex]);
        return;
      }
      validForRelations.add(holeIndex);
    });

    for (let first = 0; first < holes.length; first += 1) {
      if (!validForRelations.has(first)) continue;
      for (let second = first + 1; second < holes.length; second += 1) {
        if (!validForRelations.has(second)) continue;
        if (polygonsTouchOrOverlap(polygonOf(holes[first]), polygonOf(holes[second]))) {
          addIssue(`Holes ${first} and ${second} overlap.`, [first, second]);
        }
      }
    }

    (mapState?.spawn_points || []).forEach((spawn, index) => {
      const holeIndex = findContainingHoleIndex(spawn, holes);
      if (holeIndex >= 0) addIssue(`Spawn point 'team_${spawn.team_id}' is inside hole ${holeIndex}.`, [holeIndex], { type: "spawn", index });
    });
    (mapState?.towers || []).forEach((tower, index) => {
      const holeIndex = findContainingHoleIndex(tower, holes);
      if (holeIndex >= 0) addIssue(`Tower 'tower_${tower.id}' is inside hole ${holeIndex}.`, [holeIndex], { type: "tower", index });
    });
    (mapState?.bomb_sites || []).forEach((bomb, index) => {
      const holeIndex = findCircleOverlappingHoleIndex(bomb, 250, holes);
      if (holeIndex >= 0) addIssue(`Bomb site '${String(bomb.site_letter || "A").toUpperCase()}' overlaps hole ${holeIndex}.`, [holeIndex], { type: "bomb", index });
    });

    if (holes.length && validForRelations.size === holes.length && holesDisconnectBoundary(boundary, holes)) {
      addIssue("Map holes split the playable area into disconnected regions.", holes.map((_, index) => index));
    }
    return issues;
  }

  return {
    EPSILON,
    BASE_CONNECTIVITY_CELL_SIZE,
    MAX_CONNECTIVITY_CELLS,
    isFinitePoint,
    pointsEqual,
    distinctPointCount,
    polygonArea,
    pointOnSegment,
    pointOnPolygonEdge,
    pointInPolygon,
    segmentsIntersectOrTouch,
    polygonSelfIntersects,
    polygonsTouchOrOverlap,
    polygonStrictlyInsideBoundary,
    pointToSegmentDistance,
    circleOverlapsPolygon,
    polygonOf,
    findContainingHoleIndex,
    findCircleOverlappingHoleIndex,
    parseMapHoles,
    serializeMapHoles,
    addMapHolesToPayload,
    getConnectivityGrid,
    holesDisconnectBoundary,
    validateMapHoles,
  };
}));
