import fs from 'fs';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { glob } from 'glob';

const INPUT_DIR = path.join(__dirname, '../upstream/bsdata');
const OUTPUT_DIR = path.join(__dirname, '../output');

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: true,
});

function ensureArray(val: any) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

async function runParser() {
  console.log('⚡ Starting real dataset build from upstream BSData XML...');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  if (!fs.existsSync(INPUT_DIR)) {
    console.error('❌ Error: upstream/bsdata directory does not exist!');
    process.exit(1);
  }

  const catFiles = await glob('**/*.cat', { cwd: INPUT_DIR });

  if (catFiles.length === 0) {
    console.error('❌ Error: No .cat files found inside upstream/bsdata!');
    process.exit(1);
  }

  console.log(`📂 Found ${catFiles.length} faction catalogue files. Processing...`);

  let processedCount = 0;

  for (const file of catFiles) {
    try {
      const fullPath = path.join(INPUT_DIR, file);
      const rawXml = fs.readFileSync(fullPath, 'utf-8');
      const parsed = xmlParser.parse(rawXml);

      const catalogue = parsed?.catalogue;
      if (!catalogue) continue;

      const units = extractUnitsFromCatalogue(catalogue);

      const warOrganFaction = {
        id: catalogue.id || file,
        name: catalogue.name || path.basename(file, '.cat'),
        revision: catalogue.revision || 1,
        gameSystemId: catalogue.gameSystemId,
        units: units,
      };

      const safeName = (catalogue.name || path.basename(file, '.cat')).toLowerCase().replace(/[^a-z0-9]/g, '_');
      const fileName = `${safeName}.json`;
      fs.writeFileSync(
        path.join(OUTPUT_DIR, fileName),
        JSON.stringify(warOrganFaction, null, 2)
      );
      
      processedCount++;
    } catch (err) {
      console.warn(`⚠️ Warning: Skipped file due to parse error (${file}):`, err);
    }
  }

  console.log(`✅ Successfully parsed ${processedCount} factions into real JSON datasets!`);
}

function extractUnitsFromCatalogue(catalogue: any) {
  const units: any[] = [];

  const sharedEntries = ensureArray(catalogue.sharedSelectionEntries?.selectionEntry);
  for (const entry of sharedEntries) {
    if (!entry) continue;
    units.push({
      id: entry.id || '',
      name: entry.name || 'Unknown Unit',
      type: entry.type || 'unit',
      profiles: extractProfiles(entry),
    });
  }

  const entryLinks = ensureArray(catalogue.entryLinks?.entryLink);
  for (const link of entryLinks) {
    if (!link) continue;
    units.push({
      id: link.id || '',
      name: link.name || 'Unknown Link',
      targetId: link.targetId || '',
    });
  }

  return units;
}

function extractProfiles(entry: any) {
  const profiles = ensureArray(entry.profiles?.profile);
  return profiles.map((p: any) => ({
    name: p?.name || '',
    type: p?.typeName || '',
    characteristics: extractCharacteristics(p),
  }));
}

function extractCharacteristics(profile: any) {
  const chars = ensureArray(profile?.characteristics?.characteristic);
  const charMap: Record<string, any> = {};

  for (const c of chars) {
    if (!c) continue;
    const key = c.name ? c.name.toLowerCase().replace(/[^a-z0-9]/g, '_') : 'val';
    charMap[key] = c['#text'] !== undefined ? c['#text'] : c;
  }

  return charMap;
}

runParser().catch((err) => {
  console.error('❌ Real Parser Fatal Error:', err);
  process.exit(1);
});
