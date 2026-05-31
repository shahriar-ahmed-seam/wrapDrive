#!/usr/bin/env node
/**
 * Generate a Jetpack Compose theme from the shared design tokens.
 *
 * Reads `packages/design-system/src/tokens.json` and emits a Kotlin file
 * (`WrapDriveTokens.kt`) of `Color`, `Dp`, and timing constants so the Android
 * app renders from exactly the same design truth as Desktop and Web. Run via
 * `pnpm --filter @wrapdrive/design-system codegen:android`.
 *
 * The output path defaults to the Android design-system module (created in
 * Phase 1) and can be overridden with the first CLI argument.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const TOKENS_PATH = join(repoRoot, 'packages', 'design-system', 'src', 'tokens.json');
const DEFAULT_OUT = join(
  repoRoot,
  'apps',
  'android',
  'core',
  'designsystem',
  'src',
  'main',
  'kotlin',
  'com',
  'wrapdrive',
  'designsystem',
  'WrapDriveTokens.kt',
);
const PACKAGE = 'com.wrapdrive.designsystem';

/** Convert a `#RRGGBB` hex string to a Compose `0xFFRRGGBB` literal. */
function hexToComposeColor(hex) {
  const clean = hex.replace('#', '');
  return `0xFF${clean.toUpperCase()}`;
}

function colorBlock(name, entries) {
  const lines = Object.entries(entries)
    .filter(([, v]) => typeof v === 'string' && v.startsWith('#'))
    .map(([k, v]) => `    val ${k}: Color = Color(${hexToComposeColor(v)})`)
    .join('\n');
  return `  object ${name} {\n${lines}\n  }`;
}

function dpBlock(name, entries) {
  const lines = Object.entries(entries)
    .map(([k, v]) => `    val ${k}: Dp = ${v}.dp`)
    .join('\n');
  return `  object ${name} {\n${lines}\n  }`;
}

function intBlock(name, entries) {
  const lines = Object.entries(entries)
    .map(([k, v]) => `    const val ${k}: Int = ${v}`)
    .join('\n');
  return `  object ${name} {\n${lines}\n  }`;
}

async function main() {
  const outPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_OUT;
  const tokens = JSON.parse(await readFile(TOKENS_PATH, 'utf8'));

  const body = [
    colorBlock('Brand', tokens.color.brand),
    colorBlock('Dark', tokens.color.dark),
    colorBlock('Light', tokens.color.light),
    colorBlock('Status', tokens.color.status),
    dpBlock('Spacing', tokens.spacing),
    dpBlock('Radius', tokens.radius),
    intBlock('FontSize', tokens.typography.size),
    intBlock('MotionDuration', tokens.motion.duration),
  ].join('\n\n');

  const file = `package ${PACKAGE}

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * WrapDrive design tokens for Jetpack Compose.
 *
 * Generated from packages/design-system/src/tokens.json by
 * scripts/generate-android-theme.mjs. Do not edit by hand; change the shared
 * tokens and re-run the generator so every platform stays in sync.
 */
object WrapDriveTokens {
${body}
}
`;

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, file, 'utf8');
  process.stdout.write(`Generated Compose tokens at ${outPath}\n`);
}

main().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exitCode = 1;
});
