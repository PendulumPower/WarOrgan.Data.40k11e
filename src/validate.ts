import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

// Flexible schema that accepts any valid JSON object structure from upstream BSData
const GenericDatasetSchema = z.record(z.string(), z.any());

async function validateOutput() {
  const files = await glob('output/*.json');
  console.log(`🔍 Validating ${files.length} output files...`);

  if (files.length === 0) {
    console.warn('⚠️ No output JSON files found to validate.');
    return;
  }

  for (const file of files) {
    const fullPath = path.resolve(file);
    const rawData = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    GenericDatasetSchema.parse(rawData);
  }

  console.log('✅ Validation passed cleanly across all files!');
}

validateOutput().catch((err) => {
  console.error('❌ Schema validation failed:', err);
  process.exit(1);
});
