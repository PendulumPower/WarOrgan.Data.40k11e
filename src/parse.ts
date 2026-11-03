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
  console.log('⚡ Starting dataset build from upstream XML...');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Safety check if upstream directory is missing or empty
  if (!fs.existsSync(INPUT_DIR) || fs.readdirSync(INPUT_DIR).length === 0) {
    console.warn('⚠️ Warning: upstream/bsdata directory is empty or missing.');
    console.log('Generating fallback dataset file...');
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'placeholder.json'),
      JSON.stringify({ id: 'placeholder', name: 'Placeholder Dataset', units: [] }, null, 2)
    );
    return;
  }

  const catFiles = await glob('**/*.cat', { cwd: INPUT_DIR });

  if (catFiles.length === 0) {
    console.warn('⚠️ No .cat files found in upstream/bsdata. Creating fallback dataset...');
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'placeholder.json'),
      JSON.stringify({ id: 'placeholder', name: 'Placeholder Dataset', units: [] }, null, 2)
    );
    return;
  }

  for (const file of catFiles) {
    const fullPath = path.join(INPUT_DIR, file);
    const rawXml = fs.readFileSync(fullPath, 'utf-8');
    const parsed = xmlParser.parse(rawXml);

    const catalogue = parsed.catalogue;
    if (!catalogue) continue;

    console.log(`Parsing catalogue: ${catalogue.name}`);

    const warOrganData = {
      id: catalogue.id,
      name: catalogue.name,
      revision: catalogue.revision,
      gameSystemId: catalogue.gameSystemId,
      units: extractUnits(catalogue),
    };

    const fileName = `${catalogue.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}.json`;
    fs.writeFileSync(
      path.join(OUTPUT_DIR, fileName),
      JSON.stringify(warOrganData, null, 2)
    );
  }

  console.log('✅ Parsing complete! Output written to output/');
}

function extractUnits(catalogue: any) {
  const entries = catalogue.entryLinks?.entryLink || [];
  const entriesArray = Array.isArray(entries) ? entries : [entries];

  return entriesArray.map((entry: any) => ({
    id: entry.id || 'unknown',
    name: entry.name || 'Unnamed Unit',
    targetId: entry.targetId,
  }));
}

runParser().catch((err) => {
  console.error('❌ Parser Error:', err);
  process.exit(1);
});
