import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

const ProfileSchema = z.object({
  name: z.string(),
  type: z.string(),
  characteristics: z.record(z.string(), z.any()),
});

const UnitSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string().optional(),
  targetId: z.string().optional(),
  profiles: z.array(ProfileSchema).optional(),
});

const FactionSchema = z.object({
  id: z.string(),
  name: z.string(),
  revision: z.any().optional(),
  gameSystemId: z.any().optional(),
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
