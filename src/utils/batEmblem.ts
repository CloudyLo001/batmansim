/**
 * Traces the bat silhouette into a 2D path, centred on the origin in a local
 * space roughly 172 wide by 96 tall.
 *
 * Callers set their own transform, fill style and composite mode: the bat
 * signal cuts it OUT of a glow with `destination-out`, the landing pad fills it
 * IN as a decal. Shared so the emblem on the deck and the one on the clouds are
 * literally the same shape.
 */
export function traceBatSilhouette(context: CanvasRenderingContext2D): void {
  context.beginPath();
  context.moveTo(0, -34);
  context.bezierCurveTo(6, -26, 18, -30, 30, -22);
  context.bezierCurveTo(22, -14, 24, -4, 36, 2);
  context.bezierCurveTo(56, -2, 74, 6, 86, 22);
  context.bezierCurveTo(64, 20, 46, 26, 34, 38);
  context.bezierCurveTo(22, 48, 8, 54, 0, 62);
  context.bezierCurveTo(-8, 54, -22, 48, -34, 38);
  context.bezierCurveTo(-46, 26, -64, 20, -86, 22);
  context.bezierCurveTo(-74, 6, -56, -2, -36, 2);
  context.bezierCurveTo(-24, -4, -22, -14, -30, -22);
  context.bezierCurveTo(-18, -30, -6, -26, 0, -34);
  context.closePath();
}
