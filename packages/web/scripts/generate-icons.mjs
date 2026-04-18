// Generate PWA install icons for the VMS (SmartGate) app.
// Base = OHCS emblem; overlay = gold circle with Lucide UserPlus icon at bottom-right.
// Run: node packages/web/scripts/generate-icons.mjs

import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconDir = resolve(__dirname, '../public/icons');

// Lucide UserPlus 24x24 — white strokes.
const userPlusSvgPath = `
  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="9" cy="7" r="4" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <line x1="19" y1="8" x2="19" y2="14" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
  <line x1="22" y1="11" x2="16" y2="11" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
`;

const BADGE_FILL = '#D4A017'; // OHCS gold
const BADGE_RING = '#8A6B0F'; // darker gold for ring

async function generate({ size, maskable, outName }) {
  const basePath = resolve(iconDir, `icon-${size}.png`);
  const badgeFrac = maskable ? 0.22 : 0.28;
  const badgePx = Math.round(size * badgeFrac);
  const iconFrac = 0.52;
  const iconPx = Math.round(badgePx * iconFrac);

  const badgeSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${badgePx}" height="${badgePx}" viewBox="0 0 ${badgePx} ${badgePx}">
      <circle cx="${badgePx / 2}" cy="${badgePx / 2}" r="${badgePx / 2 - 2}" fill="${BADGE_FILL}" stroke="${BADGE_RING}" stroke-width="3"/>
      <g transform="translate(${(badgePx - iconPx) / 2}, ${(badgePx - iconPx) / 2}) scale(${iconPx / 24})">${userPlusSvgPath}</g>
    </svg>
  `;

  const margin = maskable ? Math.round(size * 0.12) : Math.round(size * 0.04);
  const left = size - badgePx - margin;
  const top = size - badgePx - margin;

  const output = resolve(iconDir, outName);
  await sharp(basePath)
    .composite([{ input: Buffer.from(badgeSvg), left, top }])
    .png()
    .toFile(output + '.tmp');

  writeFileSync(output, readFileSync(output + '.tmp'));
  const { unlinkSync } = await import('node:fs');
  unlinkSync(output + '.tmp');
  console.log(`  ✓ ${outName} (${size}x${size}, badge=${badgePx}px)`);
}

console.log('VMS (SmartGate) — generating PWA icons with gold UserPlus badge...');
await generate({ size: 192, maskable: false, outName: 'icon-192.png' });
await generate({ size: 512, maskable: false, outName: 'icon-512.png' });
await generate({ size: 192, maskable: true, outName: 'icon-192-maskable.png' });
await generate({ size: 512, maskable: true, outName: 'icon-512-maskable.png' });
console.log('Done.');
