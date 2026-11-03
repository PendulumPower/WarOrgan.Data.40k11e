import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

const INPUT_DIR = path.join(__dirname, '../upstream/bsdata');
const OUTPUT_DIR = path.join(__dirname, '../output');

function ensureArray(val: any): any[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

async function runParser() {
  console.log('⚡ Starting advanced library-merged War Organ dataset compilation...');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  if (!fs.existsSync(INPUT_DIR)) {
    console.error('❌ Error: upstream/bsdata directory does not exist!');
    process.exit(1);
  }

  const jsonFiles = await glob('*.json', { cwd: INPUT_DIR, nocase: true });

  if (jsonFiles.length === 0) {
    console.error('❌ Error: No JSON files found inside upstream/bsdata!');
    process.exit(1);
  }

  // Pre-load all library data files so we can merge shared units and rules into factions
  const libraryMap: Record<string, any> = {};
  for (const file of jsonFiles) {
    if (file.toLowerCase().includes('library') || file.toLowerCase().includes('titan')) {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(INPUT_DIR, file), 'utf-8'));
        const root = content.catalogue || content;
        libraryMap[file] = root;
      } catch (e) {
        // skip malformed library files
      }
    }
  }

  console.log(`📂 Processing ${jsonFiles.length} upstream faction files with library resolution...`);

  let processedCount = 0;
  const catalogueIndex: any[] = [];

  for (const file of jsonFiles) {
    // Skip standalone library files from being output as primary factions if desired, or parse them
    try {
      const fullPath = path.join(INPUT_DIR, file);
      const rawContent = fs.readFileSync(fullPath, 'utf-8');
      const data = JSON.parse(rawContent);

      const root = data.catalogue || data;

      // Gather units from this file and relevant libraries
      let rawUnits = [
        ...ensureArray(root.units),
        ...ensureArray(root.datasheets),
        ...ensureArray(root.selectionEntries),
        ...ensureArray(root.sharedSelectionEntries),
        ...ensureArray(root.entryLinks)
      ];

      // If units are sparse, pull from available libraries
      if (rawUnits.length <= 2) {
        for (const libKey of Object.keys(libraryMap)) {
          const lib = libraryMap[libKey];
          rawUnits = [
            ...rawUnits,
            ...ensureArray(lib.units),
            ...ensureArray(lib.datasheets),
            ...ensureArray(lib.selectionEntries),
            ...ensureArray(lib.sharedSelectionEntries)
          ];
        }
      }

      const mappedUnits = rawUnits.map((u: any) => {
        const profiles = [
          ...ensureArray(u.profiles),
          ...ensureArray(u.profileList),
          ...ensureArray(u.profiles?.profile)
        ];

        return {
          id: u.id || u.targetId || Math.random().toString(),
          name: u.name || 'Unnamed Unit',
          type: u.type || 'unit',
          factionId: u.factionId || root.id || '',
          costs: ensureArray(u.costs || u.costList || u.costs?.cost).map((c: any) => ({
            name: c.name || 'pts',
            value: c.value ?? c.costVal ?? 0
          })),
          profiles: profiles.map((p: any) => ({
            name: p.name || '',
            type: p.typeName || p.type || '',
            characteristics: extractCharacteristics(p)
          })),
          rules: ensureArray(u.rules || u.ruleList || u.rules?.rule).map((r: any) => ({
            name: r.name || '',
            description: r.description || ''
          })),
          wargear: ensureArray(u.wargear || u.selections || []).map((w: any) => ({
            name: w.name || '',
            cost: w.cost || 0
          }))
        };
      });

      const rawDetachments = [
        ...ensureArray(root.detachments),
        ...ensureArray(root.detachmentRules),
        ...ensureArray(root.forces),
        ...ensureArray(root.sharedRules?.rule)
      ];

      const mappedDetachments = rawDetachments.map((d: any) => ({
        id: d.id || '',
        name: d.name || 'Standard Detachment',
        description: d.description || d.comment || '',
        rules: ensureArray(d.rules || d.detachmentAbilities || []).map((r: any) => ({
          name: r.name || '',
          description: r.description || ''
        }))
      }));

      const mappedTraits = ensureArray(root.factionTraits || root.sharedRules?.rule || root.rules).map((r: any) => ({
        name: r.name || '',
        description: r.description || ''
      }));

      const factionDataset = {
        id: root.id || file.replace('.json', ''),
        name: root.name || path.basename(file, '.json').replace('.json', ''),
        revision: root.revision || 1,
        gameSystemId: root.gameSystemId || 'wh40k-11e',
        factionTraits: mappedTraits,
        detachments: mappedDetachments.length > 0 ? mappedDetachments : [{ id: 'default', name: 'Faction Detachment', description: '', rules: [] }],
        units: mappedUnits,
        datasheets: mappedUnits
      };

      catalogueIndex.push({
        id: factionDataset.id,
        name: factionDataset.name,
        fileName: file,
        revision: factionDataset.revision
      });

      fs.writeFileSync(
        path.join(OUTPUT_DIR, file),
        JSON.stringify(factionDataset, null, 2)
      );
      
      processedCount++;
    } catch (err) {
      console.warn(`⚠️ Warning: Skipped file due to parse error (${file}):`, err);
    }
  }

  // Write master index for app loading
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'index.json'),
    JSON.stringify({
      gameSystemId: 'wh40k-11e',
      name: 'Warhammer 40k 11th Edition - War Organ Dataset',
      revision: Date.now(),
      catalogues: catalogueIndex
    }, null, 2)
  );

  console.log(`✅ Successfully compiled ${processedCount} fully merged datasets with library and detachment data!`);
}

function extractCharacteristics(profile: any) {
  const chars = ensureArray(
    profile?.characteristics || 
    profile?.characteristics?.characteristic || 
    profile?.characteristicList
  );

  const charMap: Record<string, any> = {};

  for (const c of chars) {
    if (!c) continue;
    const key = c.name ? c.name.toLowerCase().replace(/[^a-z0-9]/g, '_') : 'value';
    charMap[key] = c['#text'] !== undefined ? c['#text'] : (c.value || c.$text || '');
  }

  return charMap;
}

runParser().catch((err) => {
  console.error('❌ Parser Fatal Error:', err);
  process.exit(1);
});
