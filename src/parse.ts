/**
 * BSData (wh40k-11e, JSON) -> War Organ dataset assets   (v2)
 *
 * Output shape is taken from the Fracture "Marauders" roster, not just the README:
 *   <outputDir>/README.md
 *   <outputDir>/DataSetDefinition.json
 *   <outputDir>/Rosters/<Faction Name>.json
 * The .NET builder (dotnet run --project WarOrgan.Data.BuildDataset) validates and zips.
 *
 * Usage:
 *   tsx src/parse.ts <inputDir> <outputDir>              (or INPUT_DIR / OUTPUT_DIR env vars)
 *   tsx src/parse.ts --find <file.json> "<unit name>"    (prints a trimmed copy of that unit's BSData entry)
 *   tsx src/parse.ts --inspect <file.json>               (structural outline of a whole file)
 *
 * Known limits (phase 2): wargear Options/loadouts, per-model-count points tiers, detachments,
 * army rules, stat adjustments. Optional weapons are listed in Weapons but not in InitialWargear.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------- War Organ output model (mirrors Fracture's Marauders.json) ----------
interface StatEntry { Id: string; Value: string }
interface StatLine { StatName: string; Stats: StatEntry[]; Features: 'None' }
interface WeaponProfile { Id: string; DisplayName: string; Keywords?: string; Flags: 'None'; Stats: StatEntry[] }
interface WeaponSet { Id: string; DisplayName: string; Weapons: WeaponProfile[] }
interface TitledText { Title: string; Text: string }
interface ModelComposition {
  Limit: { Min: number; Max: number };
  ModelName: string;
  StatlineRef: string;
  Keywords: string[];
  Wargear: { InitialWargear: string[]; Options: any[] }[];
}
interface WoUnit {
  Id: string;
  DisplayName: string;
  Flags: number;
  UnitComposition: { ModelCompositions: ModelComposition[]; WargearDefinitions: any[] };
  UnitAbilities: TitledText[];
  Infos: TitledText[];
  Keywords: string[];
  CoreAbilities: string[];
  FactionKeywords: string[];
  StatLines: StatLine[];
  Weapons: WeaponSet[];
  Upgrades: any[];
  Points: { ModelCount: number; Cost: number }[];
}
interface Roster { Name: string; Units: WoUnit[]; Detachments: any[]; ArmyRules: TitledText[] }

const argv = process.argv.slice(2);

// ---------- tolerant JSON accessors (BSData JSON key names not yet fully verified) ----------
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
const nameOf = (n: any): string => String(get(n, 'name') ?? '').trim();

// ---------- debug modes ----------
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

function shrink(node: any, depth = 0): any {
  if (Array.isArray(node)) {
    const head = node.slice(0, 3).map(n => shrink(n, depth + 1));
    return node.length > 3 ? [...head, `(+${node.length - 3} more)`] : head;
  }
  if (node && typeof node === 'object') {
    if (depth > 6) return '{...}';
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, shrink(v, depth + 1)]));
  }
  return node;
}

function findByName(node: any, name: string): any | null {
  if (Array.isArray(node)) { for (const n of node) { const r = findByName(n, name); if (r) return r; } return null; }
  if (node && typeof node === 'object') {
    if (nameOf(node) === name && ['unit', 'model'].includes(String(get(node, 'type')))) return node;
    for (const v of Object.values(node)) { const r = findByName(v, name); if (r) return r; }
  }
  return null;
}

// ---------- helpers ----------
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-').trim();
const factionKeyword = (name: string) => name.split(' - ').pop()!.trim();
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
    if (Number.isNaN(value) || value < 0) continue;
    if (type === 'min') min = Math.max(value, 0);
    if (type === 'max') max = value;
  }
  return { min, max: Math.max(min, max) };
}

// ---------- BSData tree walking (follows entry/info links through the global index) ----------
const GROUP_KEYS: [string, string][] = [
  ['selectionEntryGroups', 'selectionEntryGroup'],
  ['sharedSelectionEntryGroups', 'selectionEntryGroup'],
];
const ENTRY_KEYS: [string, string][] = [
  ['selectionEntries', 'selectionEntry'],
  ['sharedSelectionEntries', 'selectionEntry'],
];

function ownProfiles(n: any, index: Map<string, any>): any[] {
  const out = [...kids(n, 'profiles', 'profile')];
  for (const l of kids(n, 'infoLinks', 'infoLink')) {
    const t = index.get(String(get(l, 'targetId')));
    const type = get(l, 'type');
    if (t && (type === 'profile' || (type === undefined && get(t, 'typeName')))) out.push(t);
  }
  return out;
}

interface Ctx { optional: boolean; group: any | null; inModel: boolean }
interface Found { profile: any; optional: boolean; group: any | null; owner: any; inModel: boolean }
interface Collected { profiles: Found[]; models: any[] }
const ROOT_CTX: Ctx = { optional: false, group: null, inModel: false };

/**
 * Every profile and model entry under `n`. `optional` = reached through a selection group (a choice);
 * `group` = the nearest such group; `owner` = the entry that carries the profile; `inModel` = under a model entry.
 */
function collect(n: any, index: Map<string, any>, ctx: Ctx = ROOT_CTX, depth = 0, seen = new Set<any>()): Collected {
  const res: Collected = {
    profiles: ownProfiles(n, index).map(profile => ({ profile, optional: ctx.optional, group: ctx.group, owner: n, inModel: ctx.inModel })),
    models: [],
  };
  if (depth > 6) return res;

  const children: { node: any; ctx: Ctx }[] = [];
  for (const [p, s] of ENTRY_KEYS) for (const c of kids(n, p, s)) children.push({ node: c, ctx });
  for (const [p, s] of GROUP_KEYS) for (const c of kids(n, p, s)) children.push({ node: c, ctx: { ...ctx, optional: true, group: c } });
  for (const l of kids(n, 'entryLinks', 'entryLink')) {
    const t = index.get(String(get(l, 'targetId')));
    if (!t) continue;
    const isGroup = get(l, 'type') === 'selectionEntryGroup';
    children.push({ node: t, ctx: isGroup ? { ...ctx, optional: true, group: t } : ctx });
  }

  for (const { node, ctx: c } of children) {
    if (seen.has(node)) continue;
    seen.add(node);
    const isModel = get(node, 'type') === 'model';
    if (isModel) res.models.push(node);
    const sub = collect(node, index, { ...c, inModel: c.inModel || isModel }, depth + 1, seen);
    res.profiles.push(...sub.profiles);
    res.models.push(...sub.models);
  }
  return res;
}

const isStat = (p: any) => /unit|model/i.test(String(get(p, 'typeName'))) && !/weapon|abilit/i.test(String(get(p, 'typeName')));
const isWeapon = (p: any) => /weapon/i.test(String(get(p, 'typeName')));
const isAbility = (p: any) => /abilit/i.test(String(get(p, 'typeName')));

const emptyChars = new Map<string, number>();
function toStats(profile: any, skip: string[] = []): StatEntry[] {
  const type = String(get(profile, 'typeName') ?? '?');
  return kids(profile, 'characteristics', 'characteristic')
    .filter(c => !skip.includes(String(get(c, 'name'))))
    .map(c => {
      const id = String(get(c, 'name'));
      let value = charValue(c);
      if (!value) { emptyChars.set(`${type}.${id}`, (emptyChars.get(`${type}.${id}`) ?? 0) + 1); value = '-'; }
      return { Id: id, Value: value };
    });
}

function ptsOf(n: any): number {
  const c = kids(n, 'costs', 'cost').find(x => String(get(x, 'name')).toLowerCase() === 'pts');
  const v = c ? Number(get(c, 'value')) : NaN;
  return Number.isFinite(v) ? v : NaN;
}

// ---------- BSData -> War Organ unit ----------
function extractUnits(cat: any, index: Map<string, any>, keyword: string, warn: (m: string) => void): WoUnit[] {
  const entries: any[] = [];
  for (const [p, s] of ENTRY_KEYS) entries.push(...kids(cat, p, s));
  for (const l of kids(cat, 'entryLinks', 'entryLink')) {
    const t = index.get(String(get(l, 'targetId')));
    if (t) entries.push(t);
  }

  const units: WoUnit[] = [];
  const seenEntries = new Set<any>();
  const usedIds = new Map<string, number>();

  for (const entry of entries) {
    if (seenEntries.has(entry) || get(entry, 'type') !== 'unit') continue;
    seenEntries.add(entry);
    const name = nameOf(entry);
    if (!name) continue;

    const all = collect(entry, index);
    const unitStat = ownProfiles(entry, index).find(isStat) ?? all.profiles.map(f => f.profile).find(isStat);

    // Cost: the unit's own pts, else the sum of its models' minimum counts x their pts.
    let cost = ptsOf(entry);
    const sources = all.models.length ? all.models : [entry];
    if (!Number.isFinite(cost)) {
      const sum = all.models.reduce((n, m) => n + minMax(m).min * (ptsOf(m) || 0), 0);
      cost = sum > 0 ? sum : NaN;
    }
    if (!Number.isFinite(cost)) { warn(`skip "${name}": no pts cost found`); continue; }

    const statLines = new Map<string, StatLine>();
    const weaponSets = new Map<string, WeaponSet>();
    const weaponKeys = new Map<string, string>();    // weapon key -> stat signature (clash detection)
    const weaponNames = new Map<string, string>();   // weapon key -> display name
    const defs = new Map<string, any>();             // WargearDefinitions by key
    const compositions: ModelComposition[] = [];
    const abilities = new Map<string, TitledText>();

    const addWeapon = (p: any): string => {
      const wName = nameOf(p);
      const stats = toStats(p, ['Keywords']);
      const sig = JSON.stringify(stats);
      let key = wName.toLowerCase();
      let n = 1;
      while (weaponKeys.has(key) && weaponKeys.get(key) !== sig) key = `${wName.toLowerCase()} ${++n}`;
      if (!weaponKeys.has(key)) {
        weaponKeys.set(key, sig);
        weaponNames.set(key, wName);
        const setName = String(get(p, 'typeName')).trim();
        const setId = setName.toUpperCase();
        if (!weaponSets.has(setId)) weaponSets.set(setId, { Id: setId, DisplayName: setName, Weapons: [] });
        const kw = kids(p, 'characteristics', 'characteristic')
          .filter(c => String(get(c, 'name')) === 'Keywords').map(charValue).find(v => v && v !== '-');
        const wp: WeaponProfile = { Id: key, DisplayName: wName, Flags: 'None', Stats: stats };
        if (kw) wp.Keywords = kw;
        weaponSets.get(setId)!.Weapons.push(wp);
      }
      return key;
    };

    // A wargear choice: one weapon uses its own key; several weapons in one entry get a definition granting them all.
    const defFor = (owner: any, keys: string[]): string => {
      const c = ptsOf(owner);
      const cost = Number.isFinite(c) ? c : 0;
      if (keys.length === 1) {
        if (!defs.has(keys[0])) defs.set(keys[0], { Key: keys[0], DisplayName: weaponNames.get(keys[0]) ?? keys[0], Cost: cost });
        return keys[0];
      }
      let k = (nameOf(owner) || keys.join(' + ')).toLowerCase();
      while (weaponKeys.has(k) || (defs.has(k) && JSON.stringify(defs.get(k).GrantsWeapons) !== JSON.stringify(keys))) k += ' set';
      if (!defs.has(k)) defs.set(k, { Key: k, DisplayName: nameOf(owner) || k, Cost: cost, GrantsWeapons: keys });
      return k;
    };

    const unitLevel = all.profiles.filter(f => !f.inModel);
    for (const src of sources) {
      const isUnit = src === entry;
      const sub = isUnit ? all : collect(src, index, { optional: false, group: null, inModel: true });
      const stat = sub.profiles.map(f => f.profile).find(isStat) ?? unitStat;
      if (!stat) { warn(`skip model in "${name}": no stat profile (searched entry, models, links)`); continue; }

      const statName = nameOf(stat) || nameOf(src) || name;
      if (!statLines.has(statName)) statLines.set(statName, { StatName: statName, Stats: toStats(stat), Features: 'None' });

      // Weapons available to this model: its own subtree plus unit-level ones.
      const pool = isUnit ? all.profiles
        : [...sub.profiles, ...unitLevel.filter(u => !sub.profiles.some(x => x.profile === u.profile))];
      const initial: string[] = [];
      const groups = new Map<any, Map<any, string[]>>();
      for (const f of pool.filter(f => isWeapon(f.profile))) {
        const key = addWeapon(f.profile);
        if (!f.optional) { if (!initial.includes(key)) initial.push(key); continue; }
        const g = f.group ?? 'root';
        if (!groups.has(g)) groups.set(g, new Map());
        const owners = groups.get(g)!;
        const keys = owners.get(f.owner) ?? [];
        if (!keys.includes(key)) keys.push(key);
        owners.set(f.owner, keys);
      }
      // Each selection group becomes one additive option block; each owner entry is one choice within it.
      const options = [...groups.values()].map(owners => ({
        Options: [...owners].map(([owner, keys]) => ({ Items: [defFor(owner, keys)] })),
      }));

      const { min, max } = isUnit ? { min: 1, max: 1 } : minMax(src);
      compositions.push({
        Limit: { Min: min, Max: max },
        ModelName: nameOf(src) || name,
        StatlineRef: statName,
        Keywords: [],
        Wargear: [{ InitialWargear: initial, Options: options }],
      });
    }
    if (!compositions.length) continue;

    // The builder rejects weapons nothing can select, so drop any that are unreachable.
    const reach = new Set<string>();
    for (const c of compositions) for (const wg of c.Wargear) {
      wg.InitialWargear.forEach(k => reach.add(k));
      for (const o of wg.Options) for (const ch of o.Options) for (const it of ch.Items) {
        const d = defs.get(it);
        if (d?.GrantsWeapons) d.GrantsWeapons.forEach((k: string) => reach.add(k)); else reach.add(it);
      }
    }
    for (const set of weaponSets.values()) set.Weapons = set.Weapons.filter(w => reach.has(w.Id));
    for (const [id, set] of weaponSets) if (!set.Weapons.length) weaponSets.delete(id);

    // Abilities from anywhere in the unit's subtree (unit-level and per-model), de-duplicated by title.
    for (const f of all.profiles.filter(f => isAbility(f.profile))) {
      const t = nameOf(f.profile);
      if (t && !abilities.has(t)) abilities.set(t, { Title: t, Text: charValue(kids(f.profile, 'characteristics', 'characteristic')[0]) });
    }
    if (compositions.every(c => c.Limit.Max === 0)) continue;

    // TODO(phase 2): per-model-count tiers. For now: one tier at the minimum unit size.
    const modelCount = Math.max(1, compositions.reduce((n, c) => n + c.Limit.Min, 0));

    const keywords = kids(entry, 'categoryLinks', 'categoryLink')
      .map(nameOf).filter(k => k && !/^(faction|configuration)/i.test(k));

    let id = name.toUpperCase();
    const seen = usedIds.get(id) ?? 0;
    usedIds.set(id, seen + 1);
    if (seen) id = `${id} (${seen + 1})`;

    units.push({
      Id: id,
      DisplayName: name,
      Flags: 0,
      UnitComposition: { ModelCompositions: compositions, WargearDefinitions: [...defs.values()] },
      UnitAbilities: [...abilities.values()],
      Infos: [],
      Keywords: keywords,
      CoreAbilities: [],
      FactionKeywords: [keyword],
      StatLines: [...statLines.values()],
      Weapons: [...weaponSets.values()],
      Upgrades: [],
      Points: [{ ModelCount: modelCount, Cost: cost }],
    });
  }
  return units;
}

// ---------- validation (README "important connections") ----------
function validateUnit(u: WoUnit, keyword: string): string | null {
  if (!u.FactionKeywords.includes(keyword)) return 'missing faction keyword';
  const statNames = new Set(u.StatLines.map(s => s.StatName));
  const weaponIds = new Set(u.Weapons.flatMap(w => w.Weapons.map(x => x.Id)));
  const defKeys = new Set(u.UnitComposition.WargearDefinitions.map((d: any) => d.Key));
  const known = (k: string) => weaponIds.has(k) || defKeys.has(k);
  for (const m of u.UnitComposition.ModelCompositions) {
    if (!statNames.has(m.StatlineRef)) return `StatlineRef "${m.StatlineRef}" has no StatLine`;
    for (const wg of m.Wargear) {
      for (const g of wg.InitialWargear) if (!known(g)) return `InitialWargear "${g}" has no weapon`;
      for (const o of wg.Options) for (const ch of o.Options) for (const it of ch.Items)
        if (!known(it)) return `option item "${it}" has no weapon or definition`;
    }
  }
  for (const sl of [...u.StatLines, ...u.Weapons.flatMap(w => w.Weapons)])
    for (const st of sl.Stats) if (!st.Value) return 'empty stat value';
  if (!u.Points.length) return 'no points';
  return null;
}

// ---------- main ----------
function main() {
  if (argv[0] === '--inspect') {
    if (!argv[1]) throw new Error('usage: --inspect <file.json>');
    console.log(outline(JSON.parse(fs.readFileSync(argv[1], 'utf-8'))).join('\n'));
    return;
  }
  if (argv[0] === '--find') {
    if (!argv[1] || !argv[2]) throw new Error('usage: --find <file.json> "<unit name>"');
    const hit = findByName(JSON.parse(fs.readFileSync(argv[1], 'utf-8')), argv[2]);
    console.log(hit ? JSON.stringify(shrink(hit), null, 1).slice(0, 12000) : `No unit/model named "${argv[2]}"`);
    return;
  }

  const inputDir = argv[0] || process.env.INPUT_DIR || './bsdata';
  const outputDir = argv[1] || process.env.OUTPUT_DIR || './WarOrgan.Data.BuildDataset/Assets/MyGame';
  if (!fs.existsSync(inputDir)) throw new Error(`Input directory '${inputDir}' does not exist`);

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

  const rosters: Roster[] = [];
  const factions: any[] = [];
  const reasonTotals = new Map<string, number>();
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
    for (const w of warnings) {
      const reason = w.replace(/"[^"]*"/g, '"…"');
      reasonTotals.set(reason, (reasonTotals.get(reason) ?? 0) + 1);
    }
    console.log(`[${name}] ${units.length} units, ${warnings.length} warnings`);
    if (!units.length) { console.warn(`[${name}] no valid units, faction skipped`); continue; }

    const [MainColor, DarkColor] = PALETTE[factions.length % PALETTE.length];
    factions.push({ Name: name, FactionKeyword: keyword, MainColor, DarkColor });
    rosters.push({ Name: name, Units: units, Detachments: [], ArmyRules: [] });
  }
  console.log('\nWarning summary:');
  for (const [r, n] of [...reasonTotals].sort((a, b) => b[1] - a[1])) console.log(`  ${n} x ${r}`);
  if (emptyChars.size) {
    console.log('\nEmpty characteristics (written as "-"):');
    for (const [k, n] of [...emptyChars].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${n} x ${k}`);
  }
  if (!rosters.length) throw new Error('No rosters produced; run --find on a failing unit and adjust extractUnits.');

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
  console.log(`\nWrote ${rosters.length} rosters, ${unitTotal} units to ${path.resolve(outputDir)}`);
}

main();
