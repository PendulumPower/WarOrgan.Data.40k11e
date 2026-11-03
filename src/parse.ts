import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

const INPUT_DIR = path.join(__dirname, '../upstream/bsdata');
const OUTPUT_DIR = path.join(__dirname, '../output');

function ensureArray(val: any): any[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return [val];
}

async function runParser() {
  console.log('⚡ Starting deep War Organ dataset conversion...');

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

  console.log(`📂 Processing ${jsonFiles.length} upstream JSON files...`);

  let processedCount = 0;

  for (const file of jsonFiles) {
    try {
      const fullPath = path.join(INPUT_DIR, file);
      const rawContent = fs.readFileSync(fullPath, 'utf-8');
      const data = JSON.parse(rawContent);

      const root = data.catalogue || data;

      // Extract entries from all possible nested keys
      const rawEntries = [
        ...ensureArray(root.selectionEntries),
        ...ensureArray(root.selectionEntries?.selectionEntry),
        ...ensureArray(root.sharedSelectionEntries),
        ...ensureArray(root.sharedSelectionEntries?.selectionEntry),
        ...ensureArray(root.entryLinks),
        ...ensureArray(root.entryLinks?.entryLink),
        ...ensureArray(root.units),
        ...ensureArray(root.datasheets)
      ];

      const datasheetsList = rawEntries.map((item: any) => {
        const itemProfiles = [
          ...ensureArray(item.profiles),
          ...ensureArray(item.profiles?.profile)
        ];

        return {
          id: item.id || item.targetId || '',
          name: item.name || 'Unnamed Datasheet',
          type: item.type || 'unit',
          targetId: item.targetId || item.id || '',
          costs: ensureArray(item.costs || item.costs?.cost).map((c: any) => ({
            name: c.name || 'pts',
            value: c.value ?? c.costVal ?? 0
          })),
          profiles: itemProfiles.map((p: any) => ({
            name: p.name || '',
            type: p.typeName || p.type || '',
            characteristics: extractCharacteristics(p)
          })),
          rules: ensureArray(item.rules || item.rules?.rule).map((r: any) => ({
            name: r.name || '',
            description: r.description || ''
          }))
        };
      });

      const detachmentsList = ensureArray(root.detachments || root.detachmentRules).map((d: any) => ({
        id: d.id || '',
        name: d.name || 'Detachment',
        description: d.description || ''
      }));

      const factionTraits = ensureArray(root.factionTraits || root.sharedRules || root.rules).map((r: any) => ({
        name: r.name || '',
        description: r.description || ''
      }));

      const warOrganFaction = {
        id: root.id || file.replace('.json', ''),
        name: root.name || path.basename(file, '.json'),
        revision: root.revision || 1,
        gameSystemId: root.gameSystemId || 'wh40k-11e',
        factionTraits: factionTraits,
        detachments: detachmentsList,
        units: datasheetsList,
        datasheets: datasheetsList
      };

      fs.writeFileSync(
        path.join(OUTPUT_DIR, file),
        JSON.stringify(warOrganFaction, null, 2)
      );

      processedCount++;
    } catch (err) {
      console.warn(`⚠️ Warning: Skipped file due to parse error (${file}):`, err);
    }
  }

  console.log(`✅ Successfully transformed ${processedCount} faction datasets for War Organ!`);
}

function extractCharacteristics(profile: any) {
  const chars = [
    ...ensureArray(profile?.characteristics),
    ...ensureArray(profile?.characteristics?.characteristic)
  ];

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
