/**
 * 002's emitter treats a `D` tile as solid, so the tile has no floor, ceiling or
 * side walls — all four are missing once the leaf slides away. This builds them
 * as one merged geometry for the whole level, so the shell costs one draw call.
 */
import { BufferAttribute, BufferGeometry } from 'three';
import { CEILING_Y, FLOOR_Y, TILE_SIZE } from '../../level';
import type { Door } from '../../interaction/door';

const QUAD_UVS = [0, 0, 1, 0, 1, 1, 0, 1];

interface Sink {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

function pushQuad(sink: Sink, corners: readonly number[], normal: readonly number[]): void {
  const base = sink.positions.length / 3;
  for (let i = 0; i < 4; i += 1) {
    sink.positions.push(corners[i * 3]!, corners[i * 3 + 1]!, corners[i * 3 + 2]!);
    sink.normals.push(normal[0]!, normal[1]!, normal[2]!);
    sink.uvs.push(QUAD_UVS[i * 2]!, QUAD_UVS[i * 2 + 1]!);
  }
  sink.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function pushDoorway(sink: Sink, door: Door): void {
  const x0 = door.x * TILE_SIZE;
  const x1 = x0 + TILE_SIZE;
  const z0 = door.z * TILE_SIZE;
  const z1 = z0 + TILE_SIZE;
  const y0 = FLOOR_Y;
  const y1 = CEILING_Y;

  pushQuad(sink, [x0, y0, z1, x1, y0, z1, x1, y0, z0, x0, y0, z0], [0, 1, 0]);
  pushQuad(sink, [x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1], [0, -1, 0]);

  if (door.axis === 'z') {
    pushQuad(sink, [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0], [0, 0, 1]);
    pushQuad(sink, [x1, y0, z1, x0, y0, z1, x0, y1, z1, x1, y1, z1], [0, 0, -1]);
  } else {
    pushQuad(sink, [x0, y0, z1, x0, y0, z0, x0, y1, z0, x0, y1, z1], [1, 0, 0]);
    pushQuad(sink, [x1, y0, z0, x1, y0, z1, x1, y1, z1, x1, y1, z0], [-1, 0, 0]);
  }
}

/** One `BufferGeometry` carrying the doorway shell of every door in the field.
 * Null when there are no doors, so the caller adds no empty mesh. */
export function buildDoorwayShell(doors: readonly Door[]): BufferGeometry | null {
  if (doors.length === 0) return null;
  const sink: Sink = { positions: [], normals: [], uvs: [], indices: [] };
  for (const door of doors) pushDoorway(sink, door);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(sink.positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(sink.normals), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(sink.uvs), 2));
  geometry.setIndex(new BufferAttribute(new Uint32Array(sink.indices), 1));
  return geometry;
}
