import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

const INPUT_DIR = path.join(__dirname, '../upstream/bsdata');
const OUTPUT_DIR = path.join(__dirname, '../output');

async function runParser() {
  console.log('⚡ Starting comprehensive dataset build for War Organ...');

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

  console.log(`📂 Found ${jsonFiles.length} source JSON files. Compiling for War Organ...`);

  let processedCount = 0;

  for (const file of jsonFiles) {
    try {
      const fullPath = path.join(INPUT_DIR, file);
      const rawContent = fs.readFileSync(fullPath, 'utf-8');
      const jsonData = JSON.parse(rawContent);

      // Map fully to War Organ's expected schema preserving all datasheets & rules
      const warOrganFaction = {
        id: jsonData.id || file.replace('.json', ''),
        name: jsonData.name || path.basename(file, '.json'),
        revision: jsonData.revision || 1,
        gameSystemId: jsonData.gameSystemId || 'wh40k-11e',
        factionTraits: jsonData.factionTraits || jsonData.rules || [],
        detachments: jsonData.detachments || [],
        units: jsonData.units || jsonData.entryLinks || jsonData.sharedSelectionEntries || [],
        datasheets: jsonData.datasheets || jsonData.units || [],
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

  console.log(`✅ Successfully compiled ${processedCount} full faction datasets into output/!`);
}

runParser().catch((err) => {
  console.error('❌ Parser Fatal Error:', err);
  process.exit(1);
});
