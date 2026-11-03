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
  console.log('⚡ Starting advanced War Organ dataset transformation...');

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

  console.log(`📂 Processing ${jsonFiles.length} upstream JSON faction files...`);

  let processedCount = 0;

  for (const file of jsonFiles) {
    try {
      const fullPath = path.join(INPUT_DIR, file);
      const rawContent = fs.readFileSync(fullPath, 'utf-8');
      const data = JSON.parse(rawContent);

      // Handle both root-level data and nested 'catalogue' wrappers from upstream
      const root = data.catalogue || data;

      // Extract selection entries, shared entries, and entry links from BattleScribe/BSData structure
      const sharedEntries = ensureArray(root.sharedSelectionEntries?.selectionEntry);
      const selectionEntries = ensureArray(root.selectionEntries?.selectionEntry);
      const entryLinks = ensureArray(root.entryLinks?.entryLink);
      const sharedProfiles = ensureArray(root.sharedProfiles?.profile);

      // Unpack and map into War Organ's expected datasheet and unit structure
      const unitsList = [
        ...sharedEntries,
        ...selectionEntries,
        ...entryLinks
      ].map((item: any) => ({
        id: item.id || '',
        name: item.name || 'Unnamed Unit',
        type: item.type || item.binding || 'unit',
        targetId: item.targetId || item.id || '',
        costs: ensureArray(item.costs?.cost),
        profiles: ensureArray(item.profiles?.profile || sharedProfiles).map((p: any) => ({
          name: p.name || '',
          type: p.typeName || '',
          characteristics: extractCharacteristics(p)
        })),
        rules: ensureArray(item.rules?.rule).map((r: any) => ({
          name: r.name || '',
          description: r.description || ''
        }))
      }));

      // Extract detachments and faction rules
      const detachmentsList = ensureArray(root.detachments || root.sharedRules?.rule || []).map((d: any) => ({
        id: d.id || '',
        name: d.name || 'Detachment',
        description: d.description || ''
      }));

      const warOrganFaction = {
        id: root.id || file.replace('.json', ''),
        name: root.name || path.basename(file, '.json').replace(/_/g, ' - '),
        revision: root.revision || 1,
        gameSystemId: root.gameSystemId || 'wh40k-11e',
        factionTraits: ensureArray(root.sharedRules?.rule || root.rules || []).map((r: any) => ({
          name: r.name || '',
          description: r.description || ''
        })),
        detachments: detachmentsList,
        units: unitsList,
        datasheets: unitsList // Populates both keys for complete War Organ compatibility
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

  console.log(`✅ Successfully transformed and formatted ${processedCount} faction datasets for War Organ!`);
}

function extractCharacteristics(profile: any) {
  const chars = ensureArray(profile?.characteristics?.characteristic);
  const charMap: Record<string, any> = {};

  for (const c of chars) {
    if (!c) continue;
    const key = c.name ? c.name.toLowerCase().replace(/[^a-z0-9]/g, '_') : 'val';
    charMap[key] = c['#text'] !== undefined ? c['#text'] : (c.value || '');
  }

  return charMap;
}

runParser().catch((err) => {
  console.error('❌ Parser Fatal Error:', err);
  process.exit(1);
});
