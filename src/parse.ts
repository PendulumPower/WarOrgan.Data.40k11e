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
  console.log('⚡ Starting comprehensive War Organ deep data compilation...');

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

  console.log(`📂 Processing ${jsonFiles.length} upstream faction files...`);

  let processedCount = 0;
  const catalogueIndex: any[] = [];

  for (const file of jsonFiles) {
    try {
      const fullPath = path.join(INPUT_DIR, file);
      const rawContent = fs.readFileSync(fullPath, 'utf-8');
      const data = JSON.parse(rawContent);

      const root = data.catalogue || data;

      // Deep extract all datasheets and units with full profile depth
      const rawUnits = [
        ...ensureArray(root.units),
        ...ensureArray(root.datasheets),
        ...ensureArray(root.selectionEntries),
        ...ensureArray(root.sharedSelectionEntries),
        ...ensureArray(root.entryLinks)
      ];

      const mappedUnits = rawUnits.map((u: any) => ({
        id: u.id || u.targetId || '',
        name: u.name || 'Unnamed Unit',
        type: u.type || 'unit',
        factionId: u.factionId || root.id || '',
        costs: ensureArray(u.costs || u.costList).map((c: any) => ({
          name: c.name || 'pts',
          value: c.value ?? c.costVal ?? 0
        })),
        profiles: ensureArray(u.profiles || u.profileList).map((p: any) => ({
          name: p.name || '',
          type: p.typeName || p.type || '',
          characteristics: extractCharacteristics(p)
        })),
        rules: ensureArray(u.rules || u.ruleList).map((r: any) => ({
          name: r.name || '',
          description: r.description || ''
        })),
        wargear: ensureArray(u.wargear || u.selections || []).map((w: any) => ({
          name: w.name || '',
          cost: w.cost || 0
        }))
      }));

      const mappedDetachments = ensureArray(root.detachments || root.detachmentRules).map((d: any) => ({
        id: d.id || '',
        name: d.name || 'Detachment',
        description: d.description || '',
        rules: ensureArray(d.rules || d.detachmentAbilities || [])
      }));

      const mappedTraits = ensureArray(root.factionTraits || root.sharedRules || root.rules).map((r: any) => ({
        name: r.name || '',
        description: r.description || ''
      }));

      const factionDataset = {
        id: root.id || file.replace('.json', ''),
        name: root.name || path.basename(file, '.json'),
        revision: root.revision || 1,
        gameSystemId: root.gameSystemId || 'wh40k-11e',
        factionTraits: mappedTraits,
        detachments: mappedDetachments,
        units: mappedUnits.length > 0 ? mappedUnits : ensureArray(data.units || data.datasheets),
        datasheets: mappedUnits.length > 0 ? mappedUnits : ensureArray(data.units || data.datasheets)
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

  // Write master index for War Organ discovery
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'index.json'),
    JSON.stringify({
      gameSystemId: 'wh40k-11e',
      name: 'Warhammer 40k 11th Edition - War Organ Dataset',
      revision: Date.now(),
      catalogues: catalogueIndex
    }, null, 2)
  );

  console.log(`✅ Successfully compiled ${processedCount} deep-parsed faction datasets!`);
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
