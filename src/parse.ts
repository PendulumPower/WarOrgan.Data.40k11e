import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';

interface Profile {
  name: string;
  type: string;
  characteristics: { [key: string]: string };
}

interface Unit {
  id: string;
  name: string;
  type: string;
  factionId: string;
  costs: Array<{ name: string; value: number }>;
  profiles: Profile[];
  rules: any[];
  wargear: any[];
}

interface CatalogueIndexItem {
  id: string;
  name: string;
  fileName: string;
  revision: number;
}

const inputDir = process.env.INPUT_DIR || './upstream-data';
const outputDir = process.env.OUTPUT_DIR || './Assets/MyGame';

// Stat key normalization to lowercase for War Organ native schema
const statKeyMap: { [key: string]: string } = {
  'M': 'm', 'Move': 'm',
  'T': 't', 'Toughness': 't',
  'SV': 'sv', 'Save': 'sv',
  'W': 'w', 'Wounds': 'w',
  'LD': 'ld', 'Leadership': 'ld', 'Ld': 'ld',
  'OC': 'oc',
  'Invulnerable Save': 'insv',
  'Base': 'base'
};

function parseCatalogue(filePath: string): { factionName: string; units: Unit[] } {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  
  if (filePath.endsWith('.json')) {
    try {
      const data = JSON.parse(fileContent);
      return { 
        factionName: data.name || path.basename(filePath, '.json'), 
        units: data.units || [] 
      };
    } catch {
      return { factionName: 'Unknown', units: [] };
    }
  }

  const parser = new XMLParser({ attributeNamePrefix: '@_', ignoreAttributes: false } as any);
  const result = parser.parse(fileContent);
  const catalogue = result.catalogue;
  if (!catalogue) return { factionName: 'Unknown', units: [] };

  const factionName = catalogue['@_name'] || path.basename(filePath, '.cat');
  const factionId = factionName.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const units: Unit[] = [];
  
  const selectionEntries = catalogue.sharedSelectionEntries?.selectionEntry || [];
  const entriesArray = Array.isArray(selectionEntries) ? selectionEntries : [selectionEntries];

  for (const entry of entriesArray) {
    if (entry['@_type'] === 'model' || entry['@_type'] === 'unit') {
      const unitName = entry['@_name'];
      if (!unitName) continue;
      
      const unitId = unitName.toLowerCase().replace(/[^a-z0-9]/g, '-');

      const profiles: Profile[] = [];
      const rawProfiles = entry.profiles?.profile || [];
      const profilesArray = Array.isArray(rawProfiles) ? rawProfiles : [rawProfiles];
      
      for (const p of profilesArray) {
        const pName = p['@_name'] || unitName;
        const pTypeName = p['@_typeName'] || 'Abilities';
        const chars: { [key: string]: string } = {};
        
        const characteristics = p.characteristics?.characteristic || [];
        const charArray = Array.isArray(characteristics) ? characteristics : [characteristics];
        
        for (const char of charArray) {
          const charName = char['@_name'];
          const charVal = char['#text']?.toString() || '';
          if (pTypeName === 'Unit' || pTypeName === 'Model') {
            const lowerKey = statKeyMap[charName] || charName.toLowerCase();
            chars[lowerKey] = charVal;
          } else {
            chars['description'] = charVal;
          }
        }

        profiles.push({
          name: pName,
          type: (pTypeName === 'Unit' || pTypeName === 'Model') ? 'Unit' : 'Abilities',
          characteristics: chars
        });
      }

      units.push({
        id: unitId,
        name: unitName,
        type: entry['@_type'] || 'unit',
        factionId: factionId,
        costs: [{ name: 'pts', value: 100 }],
        profiles: profiles,
        rules: [],
        wargear: []
      });
    }
  }

  return { factionName, units };
}

function main() {
  console.log(`Scanning input directory: ${inputDir}`);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const findFiles = (dir: string, ext: string): string[] => {
    let results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    for (const file of fs.readdirSync(dir)) {
      const filePath = path.join(dir, file);
      if (fs.statSync(filePath).isDirectory()) {
        results = results.concat(findFiles(filePath, ext));
      } else if (file.endsWith(ext)) {
        results.push(filePath);
      }
    }
    return results;
  };

  const catFiles = [...findFiles(inputDir, '.cat'), ...findFiles(inputDir, '.json')];
  console.log(`Found ${catFiles.length} catalog files to process.`);

  const cataloguesIndex: CatalogueIndexItem[] = [];

  for (const file of catFiles) {
    try {
      const { factionName, units } = parseCatalogue(file);
      if (units.length > 0) {
        const fileName = factionName.replace(/[^a-zA-Z0-9-_ ]/g, '') + '.json';
        const factionId = factionName.toLowerCase().replace(/[^a-z0-9]/g, '-');

        // Write faction JSON file directly at root of outputDir
        const rosterData = {
          id: factionId,
          name: factionName,
          revision: 1,
          gameSystemId: "wh40k-11e",
          factionTraits: [],
          detachments: [
            {
              id: "default",
              name: "Faction Detachment",
              description: "",
              rules: []
            }
          ],
          units: units
        };

        fs.writeFileSync(
          path.join(outputDir, fileName),
          JSON.stringify(rosterData, null, 2)
        );

        cataloguesIndex.push({
          id: factionId,
          name: factionName,
          fileName: fileName,
          revision: 1
        });
      }
    } catch (err) {
      console.error(`Error parsing file ${file}:`, err);
    }
  }

  // Write index.json manifesto directly at root
  const indexManifest = {
    gameSystemId: "wh40k-11e",
    name: "Warhammer 40k 11th Edition - War Organ Dataset",
    revision: Date.now(),
    catalogues: cataloguesIndex
  };

  fs.writeFileSync(
    path.join(outputDir, 'index.json'),
    JSON.stringify(indexManifest, null, 2)
  );

  console.log(`Successfully generated index.json and ${cataloguesIndex.length} root-level faction files.`);
}

main();
