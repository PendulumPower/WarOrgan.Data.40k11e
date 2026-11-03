import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

const FactionSchema = z.object({
  id: z.string(),
  name: z.string(),
  revision: z.any().optional(),
  gameSystemId: z.any().optional(),
  factionTraits: z.any().optional(),
  detachments: z.any().optional(),
  units: z.array(z.any()).default([]),
  datasheets: z.array(z.any()).default([]),
});

async function validateOutput() {
  const files = await glob('output/*.json');
  console.log(`🔍 Validating ${files.length} output files against War Organ schema...`);

  if (files.length === 0) {
    console.warn('⚠️ No output JSON files found to validate.');
    return;
  }

  for (const file of files) {
    const fullPath = path.resolve(file);
    try {
      const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
      FactionSchema.parse(content);
    } catch (err) {
      console.error(`❌ Validation error in file: ${file}`, err);
      throw err;
    }
  }

  console.log('✅ Validation passed cleanly!');
}

validateOutput().catch((err) => {
  console.error('❌ Schema validation failed:', err);
  process.exit(1);
});
