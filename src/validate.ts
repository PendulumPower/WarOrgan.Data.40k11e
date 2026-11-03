import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

const UnitSchema = z.object({
  id: z.string(),
  name: z.string(),
  targetId: z.string().optional(),
});

const FactionSchema = z.object({
  id: z.string(),
  name: z.string(),
  units: z.array(UnitSchema),
});

async function validateOutput() {
  const files = await glob('output/*.json');
  console.log(`🔍 Validating ${files.length} output JSON files against schema...`);

  if (files.length === 0) {
    console.warn('⚠️ No output JSON files found to validate. Skipping validation.');
    return;
  }

  for (const file of files) {
    const fullPath = path.resolve(file);
    const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    FactionSchema.parse(content);
  }

  console.log('✅ Validation passed cleanly!');
}

validateOutput().catch((err) => {
  console.error('❌ Schema validation failed:', err);
  process.exit(1);
});
