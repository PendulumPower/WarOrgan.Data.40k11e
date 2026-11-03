import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';

interface Stat {
  Id: string;
  Value: string;
}

interface StatLine {
  StatName: string;
  Stats: Stat[];
}

interface Unit {
  Id: string;
  DisplayName: string;
  FactionKeywords: string[];
  UnitComposition: {
    ModelCompositions: Array<{
      ModelName: string;
      Limit: { Min: number; Max: number };
      StatlineRef: string;
      Wargear: Array<{ Models: number; InitialWargear: any[] }>;
    }>;
  };
  Points: Array<{ ModelCount: number; Cost: number }>;
  StatLines: StatLine[];
  Weapons: any[];
}

interface FactionDefinition {
  Name: string;
  FactionKeyword: string;
  MainColor: string;
  DarkColor: string;
}

const inputDir = process.env.INPUT_DIR || './upstream-data';
const outputDir = process.env.OUTPUT_DIR || './Assets/MyGame';

// Color palette generator for factions
const COLORS = [
  { MainColor: '#315C91', DarkColor: '#6FA4D9' },
  { MainColor: '#913131', DarkColor: '#D96F6F' },
  { MainColor: '#319145', DarkColor: '#6FD982' },
  { MainColor: '#917931', DarkColor: '#D9B86F' },
  { MainColor: '#783191', DarkColor: '#B46FD9' }
];

function getColor(index: number) {
  return COLORS[index % COLORS.length];
}

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

  const parser = new XMLParser({ attrNodeName: '@_', ignoreAttributes: false });
  const result = parser.parse(fileContent);
  const catalogue = result.catalogue;
  if (!catalogue) return { factionName: 'Unknown', units: [] };

  const factionName = catalogue['@_name'] || path.basename(filePath, '.cat');
  const units: Unit[] = [];
  
  const selectionEntries = catalogue.sharedSelectionEntries?.selectionEntry || [];
  const entriesArray = Array.isArray(selectionEntries) ? selectionEntries : [selectionEntries];

  // Standard stat mapping to avoid duplicate conflicting keys
  const standardStatMap: { [key: string]: string } = {
    'M': 'M', 'Move': 'M',
    'T': 'T', 'Toughness': 'T',
    'SV': 'SV', 'Save': 'SV',
    'W': 'W', 'Wounds': 'W',
    'LD': 'LD', 'Leadership': 'LD',
    'OC': 'OC'
  };

  for (const entry of entriesArray) {
    if (entry['@_type'] === 'model' || entry['@_type'] === 'unit') {
      const unitName = entry['@_name'];
      if (!unitName) continue;
      
      const unitId = unitName.toUpperCase().replace(/[^A-Z0-9]/g, '_');

      const profiles = entry.profiles?.profile || [];
      const profilesArray = Array.isArray(profiles) ? profiles : [profiles];
      
      const statMap: { [key: string]: string } = {};
      for (const profile of profilesArray) {
        if (profile['@_typeName'] === 'Unit' || profile['@_typeName'] === 'Model') {
          const characteristics = profile.characteristics?.characteristic || [];
          const charArray = Array.isArray(characteristics) ? characteristics : [characteristics];
          for (const char of charArray) {
            const charName = char['@_name'];
            const charVal = char['#text']?.toString() || '';
            if (standardStatMap[charName]) {
              statMap[standardStatMap[charName]] = charVal;
            }
          }
        }
      }

      // Ensure mandatory base stats exist
      const mandatoryStats = ['M', 'T', 'SV', 'W', 'LD', 'OC'];
      for (const mStat of mandatoryStats) {
        if (!statMap[mStat]) {
          statMap[mStat] = '-';
        }
      }

      const finalStats: Stat[] = Object.keys(statMap).map(id => ({
        Id: id,
        Value: statMap[id]
      }));

      units.push({
        Id: unitId,
        DisplayName: unitName,
        FactionKeywords: [factionName],
        UnitComposition: {
          ModelCompositions: [
            {
              ModelName: unitName,
              Limit: { Min: 1, Max: 1 },
              StatlineRef: unitName,
              Wargear: [{ Models: 1, InitialWargear: [] }]
            }
          ]
        },
        Points: [{ ModelCount: 1, Cost: 100 }],
        StatLines: [
          {
            StatName: unitName,
            Stats: finalStats
          }
        ],
        Weapons: []
      });
    }
  }

  return { factionName, units };
}

function main() {
  console.log(`Scanning input directory: ${inputDir}`);
  const rostersDir = path.join(outputDir, 'Rosters');
  if (!fs.existsSync(rostersDir)) {
    fs.mkdirSync(rostersDir, { recursive: true });
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

  const factionsMap: { [key: string]: Unit[] } = {};
  const factionList: FactionDefinition[] = [];

  let colorIndex = 0;
  for (const file of catFiles) {
    try {
      const { factionName, units } = parseCatalogue(file);
      if (units.length > 0) {
        if (!factionsMap[factionName]) {
          factionsMap[factionName] = [];
          const colors = getColor(colorIndex++);
          factionList.push({
            Name: factionName,
            FactionKeyword: factionName,
            MainColor: colors.MainColor,
            DarkColor: colors.DarkColor
          });
        }
        factionsMap[factionName].push(...units);
      }
    } catch (err) {
      console.error(`Error parsing file ${file}:`, err);
    }
  }

  // 1. Write DataSetDefinition.json with required Version field
  const datasetDef = {
    Version: 1,
    Features: "None",
    Factions: factionList.length > 0 ? factionList : [
      {
        Name: "Aeldari",
        FactionKeyword: "Aeldari",
        MainColor: "#315C91",
        DarkColor: "#6FA4D9"
      }
    ],
    BattleSizeDefinitions: [
      { Name: "Incursion", PointsTotal: 1000, DetachmentPoints: 0, EnhancementLimit: 0, UnitLimit: 0 },
      { Name: "Strike Force", PointsTotal: 2000, DetachmentPoints: 0, EnhancementLimit: 0, UnitLimit: 0 },
      { Name: "Onslaught", PointsTotal: 3000, DetachmentPoints: 0, EnhancementLimit: 0, UnitLimit: 0 }
    ]
  };

  fs.writeFileSync(
    path.join(outputDir, 'DataSetDefinition.json'),
    JSON.stringify(datasetDef, null, 2)
  );
  console.log('Successfully wrote DataSetDefinition.json');

  // 2. Write individual faction JSON files in Rosters/
  for (const [factionName, units] of Object.entries(factionsMap)) {
    const safeFileName = factionName.replace(/[^a-zA-Z0-9-_]/g, '_') + '.json';
    const rosterData = {
      Name: factionName,
      Units: units
    };

    fs.writeFileSync(
      path.join(rostersDir, safeFileName),
      JSON.stringify(rosterData, null, 2)
    );
  }

  console.log(`Successfully generated rosters for ${Object.keys(factionsMap).length} factions.`);
}

main();
