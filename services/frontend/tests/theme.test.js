import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import theme from '../tailwind.config.js';

const css = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8');
const blocks = css.split('.terminal-panel, .dark');
function tokens(block) {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
}
const light = tokens(blocks[0]);
const dark = { ...light, ...tokens(blocks[1]) };
function resolve(palette, role) {
  const value = palette[role];
  return value.startsWith('var(') ? resolve(palette, value.slice(6, -1)) : value;
}
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(part => {
    const c = parseInt(part, 16) / 255;
    return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  });
  return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
}
function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + .05) / (low + .05);
}

test('Terminal Neon palette and utility roles share one source of truth', () => {
  assert.equal(light.background, '#E9E9E9');
  assert.equal(light['surface-dark'], '#122023');
  assert.equal(light.primary, '#E1FCAD');
  for (const [role, value] of Object.entries(theme.theme.extend.colors)) {
    assert.ok(light[role], `Missing ${role}`);
    assert.equal(value, `var(--${role})`);
  }
});

for (const [name, palette] of Object.entries({ light, dark })) {
  test(`${name} text, state labels and CTA pairs meet WCAG AA`, () => {
    for (const surface of ['background', 'surface', 'surface-elevated']) {
      for (const ink of ['foreground', 'muted-foreground', 'accent-ink', 'success', 'warning', 'destructive', 'simulated']) {
        const ratio = contrast(resolve(palette, ink), resolve(palette, surface));
        assert.ok(ratio >= 4.5, `${name} ${ink}/${surface}: ${ratio}`);
      }
    }
    assert.ok(contrast(resolve(palette, 'primary-foreground'), resolve(palette, 'primary')) >= 4.5);
    assert.ok(contrast(resolve(palette, 'on-destructive'), resolve(palette, 'danger-button')) >= 4.5);
    assert.ok(contrast(resolve(palette, 'focus-ring'), resolve(palette, 'background')) >= 3);
  });
}

test('components do not reintroduce literal hex colors', () => {
  function inspect(url) {
    for (const entry of readdirSync(url, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), url);
      if (entry.isDirectory()) inspect(child);
      else if (entry.name.endsWith('.jsx')) assert.doesNotMatch(readFileSync(child, 'utf8'), /#[\da-fA-F]{6}\b/, child.pathname);
    }
  }
  inspect(new URL('../src/', import.meta.url));
});
