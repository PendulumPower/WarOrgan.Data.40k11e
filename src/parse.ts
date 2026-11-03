import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

const INPUT_DIR = path.join(__dirname, '../upstream/bsdata');
const OUTPUT_DIR = path.join(__dirname, '../output');

async function runParser() {
  console.log('⚡ Starting dataset build from upstream JSON files...');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  if (!fs.existsSync(INPUT_DIR)) {
    console.error('❌ Error: upstream/bsdata directory does not exist!');
    process.exit(1);
  }

  // Find all .json files in the upstream folder
  const jsonFiles = await glob('*.json', { cwd: INPUT_DIR, nocase: true });

  if (jsonFiles.length === 0) {
    console.error('❌ Error: No .json files found inside upstream/bsdata!');
    process.exit(1);
  }

  console.log(`📂 Found ${jsonFiles.length} JSON faction files. Processing...`);

  let processedCount = 0;

  for (const file of jsonFiles) {
    try {
      const fullPath = path.join(INPUT_DIR, file);
      const rawContent = fs.readFileSync(fullPath, 'utf-8');
      const jsonData = JSON.parse(rawContent);

      // Ensure it maps nicely to War Organ's expected structure
      const warOrganFaction = {
        id: jsonData.id || file,
        name: jsonData.name || path.basename(file, '.json'),
        revision: jsonData.revision || 1,
        gameSystemId: jsonData.gameSystemId || 'wh40k-11e',
        units: jsonData.units || jsonData.entryLinks || jsonData.sharedSelectionEntries || [],
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

  console.log(`✅ Successfully processed ${processedCount} JSON datasets into output/!`);
}

runParser().catch((err) => {
  console.error('❌ Parser Fatal Error:', err);
  process.exit(1);
});
