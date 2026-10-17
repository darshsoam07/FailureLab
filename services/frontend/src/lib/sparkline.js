/**
 * Generates SVG path strings for rendering compact sparklines.
 *
 * @param {number[]} values - Array of numeric data points
 * @param {Object} [options]
 * @param {number} [options.width=100] - SVG viewBox width
 * @param {number} [options.height=24] - SVG viewBox height
 * @param {number} [options.padding=2] - Top/bottom inner padding in px
 * @returns {{ linePath: string, areaPath: string, min: number, max: number, count: number }}
 */
export function generateSparklinePaths(values, { width = 100, height = 24, padding = 2 } = {}) {
  if (!Array.isArray(values) || values.length === 0) {
    return { linePath: '', areaPath: '', min: 0, max: 0, count: 0 };
  }

  // Filter and sanitize finite numbers
  const nums = values.map(v => (typeof v === 'number' && Number.isFinite(v) ? v : 0));
  const count = nums.length;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const usableHeight = Math.max(1, height - padding * 2);

  if (count === 1) {
    const y = Number((height / 2).toFixed(1));
    const linePath = `M 0,${y} L ${width},${y}`;
    const areaPath = `M 0,${y} L ${width},${y} L ${width},${height} L 0,${height} Z`;
    return { linePath, areaPath, min, max, count };
  }

  const range = max - min;
  const stepX = width / (count - 1);

  // Map data value to Y coordinate (higher value -> smaller Y in SVG)
  const getY = (val) => {
    if (range === 0) return height / 2;
    const normalized = (val - min) / range;
    return Number((height - padding - normalized * usableHeight).toFixed(1));
  };

  const points = nums.map((v, i) => ({
    x: Number((i * stepX).toFixed(1)),
    y: getY(v),
  }));

  // Build smooth cubic bezier or line path
  let linePath = `M ${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const cx = Number(((p0.x + p1.x) / 2).toFixed(1));
    linePath += ` C ${cx},${p0.y} ${cx},${p1.y} ${p1.x},${p1.y}`;
  }

  const lastPoint = points[points.length - 1];
  const areaPath = `${linePath} L ${lastPoint.x},${height} L ${points[0].x},${height} Z`;

  return { linePath, areaPath, min, max, count };
}
