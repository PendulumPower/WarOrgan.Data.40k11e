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

  const catFiles = await glob('**/*.cat', { cwd: INPUT_DIR });

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

  console.log('SUCCESS! Parsing complete! Files saved to output/');
}

function extractUnits(catalogue: any) {
  const entries = catalogue.entryLinks?.entryLink || [];
  const entriesArray = Array.isArray(entries) ? entries : [entries];

  return entriesArray.map((entry: any) => ({
    id: entry.id,
    name: entry.name,
    targetId: entry.targetId,
  }));
}

runParser().catch(console.error);
