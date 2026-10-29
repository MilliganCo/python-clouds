const assert = require('node:assert/strict');
function luminance(rgb) {
  const linear = rgb.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function contrast(fg, bg, opacity = 1) {
  const alpha = (fg[3] ?? 1) * opacity;
  const front = fg.slice(0, 3).map((v, i) => v * alpha + bg[i] * (1 - alpha));
  const a = luminance(front), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
assert(process.argv.includes('--unit'), 'This source-only QA entrypoint supports --unit');
assert.equal(contrast([0, 0, 0], [255, 255, 255]), 21);
assert.equal(contrast([255, 255, 255], [255, 255, 255]), 1);
assert.ok(contrast([255, 255, 255], [0, 0, 0], 0.5) < contrast([255, 255, 255], [0, 0, 0]));
assert.ok(contrast([119, 119, 119], [255, 255, 255]) < 4.5);
assert.ok(contrast([118, 118, 118], [255, 255, 255]) > 4.5);
console.log('PASS:WCAG sRGB contrast,alpha composition,unrounded threshold');
