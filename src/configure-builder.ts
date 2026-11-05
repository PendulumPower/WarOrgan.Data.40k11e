/**
 * Prepares WarOrgan.Data.BuildDataset/Program.cs for a CI build (the change is NOT committed).
 *
 *  1. Version: War Organ only looks at the minor and build parts of the dataset version, so every release needs a
 *     higher build number. If Program.cs hard-codes `defaultVersion = new Version(...)`, it is rewritten to
 *     `new Version(<major>, <minor>, <build>, 0)`. If Program.cs already reads the DATASET_VERSION environment
 *     variable, nothing is patched.
 *  2. Assets folder: checks Program.cs builds from Assets/<DATASET_FOLDER>, i.e. the folder parse.ts writes to.
 *     A mismatch is the classic reason the example (Fracture) dataset gets zipped instead of yours.
 *  3. Prints the dataset ID so it appears in the log (it must never change between releases).
 *
 * Usage: tsx src/configure-builder.ts <Program.cs> <datasetFolder> <build> [major=1] [minor=1]
 */
import * as fs from 'node:fs';

const [file, folder, buildArg, majorArg = '1', minorArg = '1'] = process.argv.slice(2);
if (!file || !folder || !buildArg) {
  console.error('usage: tsx src/configure-builder.ts <Program.cs> <datasetFolder> <build> [major] [minor]');
  process.exit(1);
}
const build = Number(buildArg);
if (!Number.isInteger(build) || build < 0) throw new Error(`Invalid build number: ${buildArg}`);

let src = fs.readFileSync(file, 'utf-8');
const problems: string[] = [];

// --- assets folder ---
const folderRe = /Assets["']?\s*,\s*"([^"]+)"/g;
const folders = [...src.matchAll(folderRe)].map(m => m[1]);
if (!folders.length) console.warn('WARNING: could not find the Assets folder in Program.cs (expected Path.Combine(AppContext.BaseDirectory, "Assets", "<folder>")); not checked.');
else if (!folders.includes(folder))
  problems.push(`Program.cs builds from Assets/${folders.join(', Assets/')} but the workflow generates Assets/${folder}. Set assetsFolder in Program.cs to "${folder}" (or change DATASET_FOLDER in the workflow).`);

// --- dataset id (informational) ---
const idMatch = src.match(/defaultDatasetId\s*=\s*"([^"]+)"/);
if (idMatch) console.log(`Dataset ID: ${idMatch[1]}  (keep this unchanged between releases)`);
else console.warn('WARNING: could not find defaultDatasetId in Program.cs; not checked.');

// --- version ---
const version = `${majorArg}.${minorArg}.${build}.0`;
if (/DATASET_VERSION/.test(src)) {
  console.log(`Program.cs reads DATASET_VERSION; the workflow supplies ${version}.`);
} else {
  const versionRe = /(defaultVersion\s*=\s*)new\s*(?:Version)?\s*\([^)]*\)/;
  if (versionRe.test(src)) {
    src = src.replace(versionRe, `$1new Version(${majorArg}, ${minorArg}, ${build}, 0)`);
    fs.writeFileSync(file, src);
    console.log(`Patched defaultVersion to ${version}.`);
  } else {
    problems.push('Could not find `defaultVersion = new Version(...)` in Program.cs, so every release would carry the same version and War Organ would not see updates.');
  }
}

if (problems.length) {
  for (const p of problems) console.error(`ERROR: ${p}`);
  process.exit(1);
}
