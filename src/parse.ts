/**
 * BSData (wh40k-11e, JSON) -> War Organ dataset assets.
 *
 * Writes ONLY the files the .NET builder expects:
 *   <outputDir>/README.md
 *   <outputDir>/DataSetDefinition.json
 *   <outputDir>/Rosters/<Faction Name>.json
 * The .NET tool (dotnet run --project WarOrgan.Data.BuildDataset) validates and zips.
 *
 * Usage:
 *   tsx src/parse.ts <inputDir> <outputDir>          (or INPUT_DIR / OUTPUT_DIR env vars)
 *   tsx src/parse.ts --inspect <file.json>           (prints a structural outline; paste it to get the mapping tuned)
 *
 * NOTE: the output layer follows the War Organ README exactly. The BSData *input* side
 * (extractUnits and the helpers above it) is a best guess until it has been run against a
 * real file: use --inspect and adjust the key names if anything comes out empty.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------- War Organ output model (mirrors the README's worked example) ----------
interface StatEntry { Id: string; Value: string }
interface StatLine { StatName: string; Stats: StatEntry[] }
interface WeaponProfile { Id: string; Stats: StatEntry[] }
interface WeaponSet { Id: string; Weapons: WeaponProfile[] }
interface ModelComposition {
  ModelName: string;
  Limit: { Min: number; Max: number };
  StatlineRef: string;
  Wargear: { Models: number; InitialWargear: string[] }[];
}
interface WoUnit {
  Id: string;
  DisplayName: string;
  FactionKeywords: string[];
  UnitComposition: { ModelCompositions: ModelComposition[] };
  Points: { ModelCount: number; Cost: number }[];
  StatLines: StatLine[];
  Weapons: WeaponSet[];
}
interface Roster { Name: string; Units: WoUnit[] }

// ---------- config ----------
const argv = process.argv.slice(2);

// Stat IDs are passed through exactly as BSData names them. Do NOT lowercase blindly:
// the README example uses "Move"/"Defence" etc. Map BSData names -> the IDs the Fracture
// example / app expects here once you have confirmed them.
const STAT_ID: Record<string, string> = {};
const statId = (name: string) => STAT_ID[name] ?? name;

// ---------- tolerant JSON accessors (BSData JSON key names not yet verified) ----------
const get = (n: any, k: string): any => n?.[k] ?? n?.[`@_${k}`] ?? n?.[`@${k}`] ?? n?.[`$${k}`];
const asArray = <T>(v: T | T[] | undefined | null): T[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
const kids = (n: any, plural: string, singular: string): any[] => {
  const v = n?.[plural];
  if (v && !Array.isArray(v) && typeof v === 'object' && singular in v) return asArray(v[singular]);
  return asArray(v);
};
const charValue = (c: any): string =>
  String(c?.['#text'] ?? c?.['$text'] ?? c?.value ?? c?.text ?? '').trim();

// ---------- inspect mode ----------
function outline(node: any, depth = 0, maxDepth = 5, key = 'root'): string[] {
  const pad = '  '.repeat(depth);
  if (Array.isArray(node)) {
    const lines = [`${pad}${key}: array(${node.length})`];
    if (node.length && depth < maxDepth) lines.push(...outline(node[0], depth + 1, maxDepth, '[0]'));
    return lines;
  }
  if (node && typeof node === 'object') {
    const lines = [`${pad}${key}: object`];
    if (depth < maxDepth) for (const [k, v] of Object.entries(node)) lines.push(...outline(v, depth + 1, maxDepth, k));
    return lines;
  }
  return [`${pad}${key}: ${JSON.stringify(node)?.slice(0, 60)}`];
}

// ---------- helpers ----------
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-').trim();
const factionKeyword = (name: string) => (name.includes(' - ') ? name.split(' - ').slice(1).join(' - ') : name);
const PALETTE = [
  ['#315C91', '#6FA4D9'], ['#7A2E2E', '#D98A8A'], ['#2E6B3A', '#7FC48C'],
  ['#6B5A2E', '#D9C27F'], ['#4B2E7A', '#B08AD9'], ['#2E6B6B', '#7FC4C4'],
];

function findJsonFiles(dir: string): string[] {
  const out: string[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (f === '.git' || f === 'node_modules' || f === '.github') continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) out.push(...findJsonFiles(p));
    else if (f.endsWith('.json')) out.push(p);
  }
  return out;
}

function minMax(entry: any): { min: number; max: number } {
  let min = 1, max = 1;
  for (const c of kids(entry, 'constraints', 'constraint')) {
    const type = get(c, 'type'), value = Number(get(c, 'value'));
    if (Number.isNaN(value)) continue;
    if (type === 'min') min = value;
    if (type === 'max') max = value;
  }
  return { min, max: Math.max(min, max) };
}

function toStats(profile: any): StatEntry[] {
  return kids(profile, 'characteristics', 'characteristic').map(c => ({
    Id: statId(String(get(c, 'name'))),
    Value: charValue(c),
  }));
}

// ---------- BSData -> War Organ unit ----------
function extractUnits(cat: any, index: Map<string, any>, keyword: string, warn: (m: string) => void): WoUnit[] {
  const entries: any[] = [
    ...kids(cat, 'sharedSelectionEntries', 'selectionEntry'),
    ...kids(cat, 'selectionEntries', 'selectionEntry'),
  ];
  for (const link of kids(cat, 'entryLinks', 'entryLink')) {
    const target = index.get(String(get(link, 'targetId')));
    if (target) entries.push(target);
  }

  const units: WoUnit[] = [];
  const usedIds = new Map<string, number>();

  for (const entry of entries) {
    if (get(entry, 'type') !== 'unit') continue;
    const name = String(get(entry, 'name') ?? '').trim();
    if (!name) continue;

    const pts = kids(entry, 'costs', 'cost').find(c => String(get(c, 'name')).toLowerCase() === 'pts');
    const cost = pts ? Number(get(pts, 'value')) : NaN;
    if (!Number.isFinite(cost)) { warn(`skip "${name}": no pts cost found`); continue; }

    // Model entries: child entries typed "model"; otherwise the unit itself is the one model type.
    const modelEntries = kids(entry, 'selectionEntries', 'selectionEntry').filter(e => get(e, 'type') === 'model');
    const sources = modelEntries.length ? modelEntries : [entry];

    const statLines = new Map<string, StatLine>();
    const weaponSets = new Map<string, WeaponSet>();
    const compositions: ModelComposition[] = [];

    for (const src of sources) {
      const profiles = kids(src, 'profiles', 'profile');
      const unitProfile = profiles.find(p => get(p, 'typeName') === 'Unit')
        ?? kids(entry, 'profiles', 'profile').find(p => get(p, 'typeName') === 'Unit');
      if (!unitProfile) { warn(`skip model in "${name}": no Unit profile`); continue; }

      const statName = String(get(unitProfile, 'name') ?? get(src, 'name') ?? name);
      if (!statLines.has(statName)) statLines.set(statName, { StatName: statName, Stats: toStats(unitProfile) });

      const gear: string[] = [];
      for (const w of profiles.filter(p => String(get(p, 'typeName')).includes('Weapon'))) {
        const wName = String(get(w, 'name'));
        gear.push(wName);
        if (!weaponSets.has(wName))
          weaponSets.set(wName, { Id: wName, Weapons: [{ Id: wName, Stats: toStats(w) }] });
      }

      const { min, max } = modelEntries.length ? minMax(src) : { min: 1, max: 1 };
      compositions.push({
        ModelName: String(get(src, 'name') ?? name),
        Limit: { Min: min, Max: max },
        StatlineRef: statName,
        Wargear: [{ Models: min, InitialWargear: gear }],
      });
    }
    if (!compositions.length) continue;

    // TODO: BSData expresses per-model-count pricing via modifiers; this emits the minimum-size cost only.
    const modelCount = compositions.reduce((n, c) => n + c.Limit.Min, 0);

    let id = name.toUpperCase();
    const seen = usedIds.get(id) ?? 0;
    usedIds.set(id, seen + 1);
    if (seen) id = `${id} (${seen + 1})`;

    units.push({
      Id: id,
      DisplayName: name,
      FactionKeywords: [keyword],
      UnitComposition: { ModelCompositions: compositions },
      Points: [{ ModelCount: modelCount, Cost: cost }],
      StatLines: [...statLines.values()],
      Weapons: [...weaponSets.values()],
    });
  }
  return units;
}

// ---------- validation (the README's "important connections") ----------
function validateUnit(u: WoUnit, keyword: string): string | null {
  if (!u.FactionKeywords.includes(keyword)) return 'missing faction keyword';
  const statNames = new Set(u.StatLines.map(s => s.StatName));
  const weaponIds = new Set(u.Weapons.map(w => w.Id));
  for (const m of u.UnitComposition.ModelCompositions) {
    if (!statNames.has(m.StatlineRef)) return `StatlineRef "${m.StatlineRef}" has no StatLine`;
    for (const wg of m.Wargear)
      for (const g of wg.InitialWargear) if (!weaponIds.has(g)) return `InitialWargear "${g}" has no weapon`;
  }
  if (!u.Points.length) return 'no points';
  return null;
}

// ---------- main ----------
function main() {
  if (argv[0] === '--inspect') {
    const file = argv[1];
    if (!file) throw new Error('usage: --inspect <file.json>');
    console.log(outline(JSON.parse(fs.readFileSync(file, 'utf-8'))).join('\n'));
    return;
  }

  const inputDir = argv[0] || process.env.INPUT_DIR || './bsdata';
  const outputDir = argv[1] || process.env.OUTPUT_DIR || './WarOrgan.Data.BuildDataset/Assets/MyGame';
  if (!fs.existsSync(inputDir)) throw new Error(`Input directory '${inputDir}' does not exist`);

  // 1. Load everything and build a global id index (libraries are reachable only via links).
  const catalogues: { file: string; cat: any }[] = [];
  const index = new Map<string, any>();
  const walk = (n: any) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object') {
      const id = get(n, 'id');
      if (typeof id === 'string') index.set(id, n);
      Object.values(n).forEach(walk);
    }
  };
  for (const file of findJsonFiles(inputDir)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      walk(data);
      const cat = data.catalogue ?? (data.gameSystem ? null : data);
      if (cat) catalogues.push({ file, cat });
    } catch (e) {
      console.warn(`Could not parse ${file}: ${e}`);
    }
  }
  console.log(`Loaded ${catalogues.length} catalogues, ${index.size} ids indexed.`);

  // 2. Convert faction catalogues (skip Library files).
  const rosters: Roster[] = [];
  const factions: any[] = [];
  for (const { file, cat } of catalogues) {
    const base = path.basename(file, '.json');
    if (/library/i.test(base)) continue;
    const name = safeName(String(get(cat, 'name') ?? base));
    const keyword = factionKeyword(name);

    const warnings: string[] = [];
    const units = extractUnits(cat, index, keyword, m => warnings.push(m))
      .filter(u => {
        const err = validateUnit(u, keyword);
        if (err) warnings.push(`drop "${u.DisplayName}": ${err}`);
        return !err;
      });
    warnings.slice(0, 10).forEach(w => console.warn(`[${name}] ${w}`));
    if (warnings.length > 10) console.warn(`[${name}] ...and ${warnings.length - 10} more warnings`);
    if (!units.length) { console.warn(`[${name}] no valid units, faction skipped`); continue; }

    const [MainColor, DarkColor] = PALETTE[factions.length % PALETTE.length];
    factions.push({ Name: name, FactionKeyword: keyword, MainColor, DarkColor });
    rosters.push({ Name: name, Units: units });
  }
  if (!rosters.length) throw new Error('No rosters produced; run --inspect on a faction file and adjust extractUnits.');

  // 3. Write the dataset assets.
  fs.mkdirSync(path.join(outputDir, 'Rosters'), { recursive: true });
  for (const r of rosters)
    fs.writeFileSync(path.join(outputDir, 'Rosters', `${r.Name}.json`), JSON.stringify(r, null, 2));

  const definition = {
    Features: 'None',
    Factions: factions,
    BattleSizeDefinitions: [
      { Name: 'Incursion', PointsTotal: 1000, DetachmentPoints: 0, EnhancementLimit: 0, UnitLimit: 0 },
      { Name: 'Strike Force', PointsTotal: 2000, DetachmentPoints: 0, EnhancementLimit: 0, UnitLimit: 0 },
      { Name: 'Onslaught', PointsTotal: 3000, DetachmentPoints: 0, EnhancementLimit: 0, UnitLimit: 0 },
    ],
  };
  fs.writeFileSync(path.join(outputDir, 'DataSetDefinition.json'), JSON.stringify(definition, null, 2));

  const sha = process.env.UPSTREAM_SHA ? ` (commit ${process.env.UPSTREAM_SHA})` : '';
  fs.writeFileSync(
    path.join(outputDir, 'README.md'),
    `# Warhammer 40,000 11th Edition\n\nGenerated automatically from the community-maintained BSData repository ` +
      `https://github.com/BSData/wh40k-11e${sha}.\nNot endorsed by any company or publisher.\n`,
  );

  const unitTotal = rosters.reduce((n, r) => n + r.Units.length, 0);
  console.log(`Wrote ${rosters.length} rosters, ${unitTotal} units to ${path.resolve(outputDir)}`);
}

main();
