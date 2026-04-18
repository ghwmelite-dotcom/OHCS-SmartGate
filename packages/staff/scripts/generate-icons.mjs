// Generate PWA install icons for the Staff Attendance app.
// Base = OHCS emblem; overlay = green circle with Lucide Clock icon at bottom-right.
// Run: node packages/staff/scripts/generate-icons.mjs

import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconDir = resolve(__dirname, '../public/icons');

// Lucide Clock 24x24 — used inside the badge at white.
const clockSvgPath = `
  <circle cx="12" cy="12" r="10" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <polyline points="12 6 12 12 16 14" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
`;

const BADGE_FILL = '#1A7A3A'; // success green
const BADGE_RING = '#0F2E1B'; // deep green header gradient end

async function generate({ size, maskable, outName }) {
  const basePath = resolve(iconDir, `icon-${size}.png`);
  // Maskable icons reserve the outer 20% as safe padding; non-maskable fill edge-to-edge.
  // Badge is 28% of the icon for non-maskable, 22% for maskable (so it stays inside the safe circle).
  const badgeFrac = maskable ? 0.22 : 0.28;
  const badgePx = Math.round(size * badgeFrac);
  // Inner icon (the Lucide stroke art) fills ~52% of the badge (leaves white padding inside).
  const iconFrac = 0.52;
  const iconPx = Math.round(badgePx * iconFrac);

  // SVG of just the badge (colored circle + white clock icon).
  const badgeSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${badgePx}" height="${badgePx}" viewBox="0 0 ${badgePx} ${badgePx}">
      <circle cx="${badgePx / 2}" cy="${badgePx / 2}" r="${badgePx / 2 - 2}" fill="${BADGE_FILL}" stroke="${BADGE_RING}" stroke-width="3"/>
      <g transform="translate(${(badgePx - iconPx) / 2}, ${(badgePx - iconPx) / 2}) scale(${iconPx / 24})">${clockSvgPath}</g>
    </svg>
  `;

  // Position: bottom-right, with a small margin from the edge.
  // For maskable: place further from edge (respect safe zone). For non-maskable: closer to edge.
  const margin = maskable ? Math.round(size * 0.12) : Math.round(size * 0.04);
  const left = size - badgePx - margin;
  const top = size - badgePx - margin;

  const output = resolve(iconDir, outName);
  await sharp(basePath)
    .composite([{ input: Buffer.from(badgeSvg), left, top }])
    .png()
    .toFile(output + '.tmp');

  // Replace original atomically.
  writeFileSync(output, readFileSync(output + '.tmp'));
  // Clean up tmp file.
  const { unlinkSync } = await import('node:fs');
  unlinkSync(output + '.tmp');
  console.log(`  ✓ ${outName} (${size}x${size}, badge=${badgePx}px)`);
}

console.log('Staff Attendance — generating PWA icons with green Clock badge...');
await generate({ size: 192, maskable: false, outName: 'icon-192.png' });
await generate({ size: 512, maskable: false, outName: 'icon-512.png' });
await generate({ size: 192, maskable: true, outName: 'icon-192-maskable.png' });
await generate({ size: 512, maskable: true, outName: 'icon-512-maskable.png' });
console.log('Done.');
