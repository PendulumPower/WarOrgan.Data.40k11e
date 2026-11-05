/**
 * Fail-soft validation for the War Organ build.
 *
 * The .NET builder (WarOrgan.Data.BuildDataset) writes NO zip if anything fails validation, and it prints
 * errors in the form
 *     <Faction Name>.<UNIT ID>[.<Model name>]: <message>        (unit or model level)
 *     <Faction Name>: <message>                                 (faction level)
 * This script reads that log and removes the offending units from the generated rosters, so the next build
 * attempt can succeed. Everything removed is recorded in build-report.json and shown in the release notes,
 * so nothing disappears silently.
 *
 * Usage:
 *   tsx src/prune.ts <build.log> <assetsDir> [--drop-factions]
 *       exit 0 = something was removed (rebuild), 2 = errors found but nothing removable, 3 = no errors found
 *   tsx src/prune.ts --summary [build-report.json]
 *       prints a markdown summary for the release notes
 *
 * --drop-factions: also remove a whole faction when it has a faction-level error that pruning units cannot fix.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

interface Removed { faction: string; unit: string; message: string }
interface Report {
  upstreamSha?: string | null;
  converted?: { rosters: number; units: number };
  conversionWarnings?: Record<string, number>;
  emptyCharacteristics?: Record<string, number>;
  removedByValidation?: Removed[];
  removedFactions?: { faction: string; message: string }[];
  validationRounds?: number;
}

const args: string[] = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const pos = args.filter(a => !a.startsWith('--'));
const reportPath = process.env.REPORT_PATH || './build-report.json';

const loadReport = (p: string): Report => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : {});
const category = (msg: string) => msg.replace(/'[^']*'/g, "'…'").replace(/"[^"]*"/g, '"…"');

// ---------- --summary: markdown for the release notes ----------
if (flags.has('--summary')) {
  const r = loadReport(pos[0] ?? reportPath);
  const out: string[] = [];
  if (r.converted) out.push(`**Included:** ${r.converted.units} units across ${r.converted.rosters} factions (before validation).`);
  const removed = r.removedByValidation ?? [];
  const droppedFactions = r.removedFactions ?? [];
  if (!removed.length && !droppedFactions.length) {
    out.push('All converted units passed War Organ validation.');
  } else {
    if (removed.length) {
      out.push(`**Left out after validation:** ${removed.length} units.`);
      const byCat = new Map<string, number>();
      for (const u of removed) byCat.set(category(u.message), (byCat.get(category(u.message)) ?? 0) + 1);
      out.push('', 'Reasons:', ...[...byCat].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([m, n]) => `- ${n} × ${m}`));
      out.push('', '<details><summary>Units left out</summary>', '');
      for (const u of removed.slice(0, 150)) out.push(`- ${u.faction}: ${u.unit}`);
      if (removed.length > 150) out.push(`- …and ${removed.length - 150} more`);
      out.push('', '</details>');
    }
    if (droppedFactions.length)
      out.push('', `**Factions left out entirely:** ${droppedFactions.map(f => f.faction).join(', ')}`);
  }
  console.log(out.join('\n'));
  process.exit(0);
}

// ---------- prune ----------
const [logPath, assetsDir] = pos;
if (!logPath || !assetsDir) {
  console.error('usage: tsx src/prune.ts <build.log> <assetsDir> [--drop-factions]   |   tsx src/prune.ts --summary [report]');
  process.exit(1);
}

const rostersDir = path.join(assetsDir, 'Rosters');
const rosters = new Map<string, { file: string; data: any }>();
for (const f of (fs.readdirSync(rostersDir) as string[]).filter(f => f.endsWith('.json'))) {
  const file = path.join(rostersDir, f);
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  rosters.set(String(data.Name), { file, data });
}
const factionNames = [...rosters.keys()].sort((a, b) => b.length - a.length); // longest first

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const badUnits = new Map<string, Removed>();          // "faction\tunit" -> first message
const badFactions = new Map<string, string>();        // faction -> first message
const unattributed: string[] = [];

for (const raw of fs.readFileSync(logPath, 'utf-8').split(/\r?\n/)) {
  const line = stripAnsi(raw).trim();
  const idx = line.indexOf(': ');
  if (idx < 1) continue;
  const left = line.slice(0, idx);
  const message = line.slice(idx + 2);

  const faction = factionNames.find(n => left === n || left.startsWith(`${n}.`));
  if (!faction) continue;                                // not a validation line (e.g. "Dataset build failed: ...")
  const rest = left.slice(faction.length + 1);
  if (!rest) {
    if (!badFactions.has(faction)) badFactions.set(faction, message);
    continue;
  }
  const unitIds = (rosters.get(faction)!.data.Units as any[]).map(u => String(u.Id)).sort((a, b) => b.length - a.length);
  const unit = unitIds.find(id => rest === id || rest.startsWith(`${id}.`));
  if (unit) {
    const key = `${faction}\t${unit}`;
    if (!badUnits.has(key)) badUnits.set(key, { faction, unit, message });
  } else {
    unattributed.push(line);
  }
}

console.log(`Validation log: ${badUnits.size} units and ${badFactions.size} factions with errors` +
  (unattributed.length ? `, ${unattributed.length} lines not attributable to a unit` : ''));
if (!badUnits.size && !badFactions.size) {
  console.log('No removable errors found.');
  process.exit(unattributed.length ? 2 : 3);
}

const report = loadReport(reportPath);
report.removedByValidation ??= [];
report.removedFactions ??= [];
report.validationRounds = (report.validationRounds ?? 0) + 1;

const definitionPath = path.join(assetsDir, 'DataSetDefinition.json');
const definition = JSON.parse(fs.readFileSync(definitionPath, 'utf-8'));
const dropFaction = (name: string) => {
  const r = rosters.get(name);
  if (r) fs.rmSync(r.file, { force: true });
  rosters.delete(name);
  definition.Factions = (definition.Factions as any[]).filter(f => f.Name !== name);
};

let changed = 0;
for (const { faction, unit, message } of badUnits.values()) {
  const r = rosters.get(faction);
  if (!r) continue;
  r.data.Units = (r.data.Units as any[]).filter(u => u.Id !== unit);
  report.removedByValidation.push({ faction, unit, message });
  changed++;
}
for (const [name, r] of [...rosters]) {
  if (!(r.data.Units as any[]).length) { dropFaction(name); changed++; console.log(`Faction "${name}" has no units left, removed.`); }
  else fs.writeFileSync(r.file, JSON.stringify(r.data, null, 2));
}
if (flags.has('--drop-factions')) {
  for (const [name, message] of badFactions) {
    if (!rosters.has(name)) continue;
    dropFaction(name);
    report.removedFactions.push({ faction: name, message });
    changed++;
    console.log(`Faction "${name}" removed (faction-level error: ${message})`);
  }
}
fs.writeFileSync(definitionPath, JSON.stringify(definition, null, 2));
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

if (!rosters.size) { console.error('Every faction was removed; nothing left to build.'); process.exit(2); }
if (!changed) { console.log('Faction-level errors remain and --drop-factions was not set.'); process.exit(2); }

const byCat = new Map<string, number>();
for (const u of badUnits.values()) byCat.set(category(u.message), (byCat.get(category(u.message)) ?? 0) + 1);
for (const [m, n] of [...byCat].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  removed ${n} × ${m}`);
process.exit(0);
