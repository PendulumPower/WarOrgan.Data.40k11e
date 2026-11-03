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

async function runParser() {
  console.log('⚡ Starting real dataset build from upstream BSData XML...');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  if (!fs.existsSync(INPUT_DIR)) {
    console.error('❌ Error: upstream/bsdata directory does not exist!');
    process.exit(1);
  }

  // Find all .cat files recursively in the upstream folder
  const catFiles = await glob('**/*.cat', { cwd: INPUT_DIR });

  if (catFiles.length === 0) {
    console.error('❌ Error: No .cat files found inside upstream/bsdata!');
    process.exit(1);
  }

  console.log(`📂 Found ${catFiles.length} faction catalogue files. Processing...`);

  let processedCount = 0;

  for (const file of catFiles) {
    const fullPath = path.join(INPUT_DIR, file);
    const rawXml = fs.readFileSync(fullPath, 'utf-8');
    const parsed = xmlParser.parse(rawXml);

    const catalogue = parsed.catalogue;
    if (!catalogue) continue;

    // Extract units from shared entries or entry links
    const units = extractUnitsFromCatalogue(catalogue);

    const warOrganFaction = {
      id: catalogue.id || file,
      name: catalogue.name || path.basename(file, '.cat'),
      revision: catalogue.revision || 1,
      gameSystemId: catalogue.gameSystemId,
      units: units,
    };

    const fileName = `${catalogue.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}.json`;
    fs.writeFileSync(
      path.join(OUTPUT_DIR, fileName),
      JSON.stringify(warOrganFaction, null, 2)
    );
    
    processedCount++;
  }

  console.log(`✅ Successfully parsed ${processedCount} factions into real JSON datasets!`);
}

function extractUnitsFromCatalogue(catalogue: any) {
  const units: any[] = [];

  // BattleScribe catalogues can store entries in sharedEntries or entryLinks
  const sharedEntries = catalogue.sharedSelectionEntries?.selectionEntry || [];
  const entriesArray = Array.isArray(sharedEntries) ? sharedEntries : [sharedEntries];

  for (const entry of entriesArray) {
    if (entry.type === 'model' || entry.type === 'unit' || entry.characteristicTypes || entry.profiles) {
      units.push({
        id: entry.id,
        name: entry.name,
        type: entry.type,
        profiles: extractProfiles(entry),
      });
    }
  }

  // Also check entryLinks if units are referenced that way
  const entryLinks = catalogue.entryLinks?.entryLink || [];
  const linksArray = Array.isArray(entryLinks) ? entryLinks : [entryLinks];
  
  for (const link of linksArray) {
    units.push({
      id: link.id,
      name: link.name,
      targetId: link.targetId,
    });
  }

  return units;
}

function extractProfiles(entry: any) {
  const profiles = entry.profiles?.profile || [];
  const profilesArray = Array.isArray(profiles) ? profiles : [profiles];

  return profilesArray.map((p: any) => ({
    name: p.name,
    type: p.typeName,
    characteristics: extractCharacteristics(p),
  }));
}

function extractCharacteristics(profile: any) {
  const chars = profile.characteristics?.characteristic || [];
  const charsArray = Array.isArray(chars) ? chars : [chars];
  const charMap: Record<string, any> = {};

  for (const c of charsArray) {
    const key = c.name ? c.name.toLowerCase().replace(/[^a-z0-9]/g, '_') : 'val';
    charMap[key] = c['#text'] !== undefined ? c['#text'] : c;
  }

  return charMap;
}

runParser().catch((err) => {
  console.error('❌ Real Parser Error:', err);
  process.exit(1);
});
