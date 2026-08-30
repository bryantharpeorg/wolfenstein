import { describe, it, expect } from 'vitest';
import { emitFaces } from '../../src/geometry/faces';
import { LEVEL_GRID } from '../../src/level';
import { buildDoorField } from '../../src/interaction/door-field';
import { isDoorTileGeometry } from '../../src/systems/doors/static-faces';

// The doors system must recognise 002's `D` wall group rather than be handed it,
// so this asserts the recognition against 002's real output.

const doors = buildDoorField(LEVEL_GRID).doors;
const faces = emitFaces(LEVEL_GRID);

describe('recognising 002 door-tile geometry (T017)', () => {
  it('matches the D wall group and no other', () => {
    const matched = Object.keys(faces.walls).filter((type) =>
      isDoorTileGeometry(faces.walls[type]!.positions, doors),
    );
    expect(matched).toEqual(['D']);
  });

  it('matches neither the floor nor the ceiling', () => {
    expect(isDoorTileGeometry(faces.floor.positions, doors)).toBe(false);
    expect(isDoorTileGeometry(faces.ceiling.positions, doors)).toBe(false);
  });

  it('matches the secret group no better than any wall group', () => {
    expect(faces.walls['S']).toBeDefined();
    expect(isDoorTileGeometry(faces.walls['S']!.positions, doors)).toBe(false);
  });

  it('hides nothing when there are no doors and nothing for an empty geometry', () => {
    expect(isDoorTileGeometry(faces.walls['D']!.positions, [])).toBe(false);
    expect(isDoorTileGeometry(new Float32Array(0), doors)).toBe(false);
  });
});
