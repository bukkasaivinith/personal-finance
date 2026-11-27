import type { WorkoutDetails } from './athlete-workout';

export type RouteCoordinate = NonNullable<WorkoutDetails['route']>[number];
export const routeViewport = { width: 420, height: 310 };

const mercatorLimit = 85.05112878;
const radians = Math.PI / 180;
const equatorMeters = 2 * Math.PI * 6_378_137;
const wrap = (value: number, period: number) => ((value % period) + period) % period;

export function fitWorkoutRoute(coordinates: RouteCoordinate[]) {
  if (coordinates.length < 2) return undefined;
  const { width, height } = routeViewport;
  const origin = (coordinates[0].longitude + 180) / 360;
  const surface = coordinates.map(({ longitude, latitude, segment }) => {
    const x = (longitude + 180) / 360;
    const lat = Math.max(-mercatorLimit, Math.min(mercatorLimit, latitude)) * radians;
    return { x: origin + wrap(x - origin + 0.5, 1) - 0.5, y: 0.5 - Math.asinh(Math.tan(lat)) / (2 * Math.PI), segment };
  });
  const bounds = surface.reduce((box, point) => ({
    left: Math.min(box.left, point.x), right: Math.max(box.right, point.x),
    top: Math.min(box.top, point.y), bottom: Math.max(box.bottom, point.y),
  }), { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
  const scale = Math.min((width - 70) / Math.max(1 / equatorMeters, bounds.right - bounds.left),
    (height - 88) / Math.max(1 / equatorMeters, bounds.bottom - bounds.top));
  const middleX = (bounds.left + bounds.right) / 2;
  const middleY = (bounds.top + bounds.bottom) / 2;
  const left = middleX - width / (2 * scale);
  const top = middleY - height / (2 * scale);
  const points = surface.map((point) => ({ x: (point.x - left) * scale, y: (point.y - top) * scale, segment: point.segment }));
  const path = points.map((point, index) => (index > 0 && points[index - 1].segment === point.segment ? 'L' : 'M')
    + point.x.toFixed(2) + ',' + point.y.toFixed(2)).join(' ');
  const latitudeAtCenter = Math.atan(Math.sinh(Math.PI * (1 - 2 * middleY)));
  const metersPerPixel = equatorMeters * Math.cos(latitudeAtCenter) / scale;
  const approxMeters = 86 * metersPerPixel;
  const magnitude = 10 ** Math.floor(Math.log10(approxMeters));
  const ratio = approxMeters / magnitude;
  const scaleMeters = (ratio >= 5 ? 5 : ratio >= 2 ? 2 : 1) * magnitude;

  const zoom = Math.max(0, Math.min(19, Math.ceil(Math.log2(scale / 256))));
  const worldTiles = 2 ** zoom;
  const tileSize = scale / worldTiles;
  const startX = Math.floor(left * worldTiles);
  const endX = Math.ceil((left + width / scale) * worldTiles);
  const startY = Math.max(0, Math.floor(top * worldTiles));
  const endY = Math.min(worldTiles, Math.ceil((top + height / scale) * worldTiles));
  // Use the same world-to-view transform for both raster tiles and the GPS line.
  const tiles = [];
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      tiles.push({ id: x + ':' + y, zoom, x: wrap(x, worldTiles), y, left: x * tileSize - left * scale,
        top: y * tileSize - top * scale, size: tileSize });
    }
  }
  return { path, first: points[0], last: points[points.length - 1], scaleMeters, scaleWidth: scaleMeters / metersPerPixel, tiles };
}
