import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

const INPUT_DIR = path.join(__dirname, '../upstream/bsdata');
const OUTPUT_DIR = path.join(__dirname, '../output');

async function runParser() {
  console.log('⚡ Starting full-fidelity War Organ dataset compilation...');

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

  console.log(`📂 Processing ${jsonFiles.length} upstream JSON files with 100% data retention...`);

  let processedCount = 0;
  const catalogueIndex: any[] = [];

  for (const file of jsonFiles) {
    try {
      const fullPath = path.join(INPUT_DIR, file);
      const rawContent = fs.readFileSync(fullPath, 'utf-8');
      const data = JSON.parse(rawContent);

      // Preserve the entire upstream object structure while ensuring War Organ core properties exist
      const factionDataset = {
        ...data,
        id: data.id || file.replace('.json', ''),
        name: data.name || path.basename(file, '.json'),
        revision: data.revision || 1,
        gameSystemId: data.gameSystemId || 'wh40k-11e',
      };

      // Add to index manifest if War Organ requires index tracking
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

  // Write a master index.json file in output/ in case War Organ reads a manifest
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'index.json'),
    JSON.stringify({
      gameSystemId: 'wh40k-11e',
      name: 'Warhammer 40k 11th Edition - War Organ Dataset',
      revision: Date.now(),
      catalogues: catalogueIndex
    }, null, 2)
  );

  console.log(`✅ Successfully compiled ${processedCount} full-fidelity datasets + index.json into output/!`);
}

runParser().catch((err) => {
  console.error('❌ Parser Fatal Error:', err);
  process.exit(1);
});
