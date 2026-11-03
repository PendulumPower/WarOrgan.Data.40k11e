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

const inputDir = process.env.INPUT_DIR || './upstream-data';
const outputDir = process.env.OUTPUT_DIR || './Assets/MyGame';

function parseCatalogue(filePath: string): Unit[] {
  const xmlData = fs.readFileSync(filePath, 'utf-8');
  const parser = new XMLParser({ attrNodeName: "@_", ignoreAttributes: false });
  const result = parser.parse(xmlData);

  const units: Unit[] = [];
  const catalogue = result.catalogue;
  if (!catalogue) return units;

  // Extract shared selection entries or profiles from BattleScribe XML structure
  const selectionEntries = catalogue.sharedSelectionEntries?.selectionEntry || [];
  const entriesArray = Array.isArray(selectionEntries) ? selectionEntries : [selectionEntries];

  for (const entry of entriesArray) {
    if (entry["@_type"] === "model" || entry["@_type"] === "unit") {
      const unitName = entry["@_name"];
      const unitId = unitName.toUpperCase().replace(/[^A-Z0-9]/g, '_');

      // Extract profiles (Statlines)
      const profiles = entry.profiles?.profile || [];
      const profilesArray = Array.isArray(profiles) ? profiles : [profiles];
      
      const stats: Stat[] = [];
      for (const profile of profilesArray) {
        if (profile["@_typeName"] === "Unit") {
          const characteristics = profile.characteristics?.characteristic || [];
          const charArray = Array.isArray(characteristics) ? characteristics : [characteristics];
          for (const char of charArray) {
            stats.push({
              Id: char["@_name"],
              Value: char["#text"]?.toString() || ""
            });
          }
        }
      }

      units.push({
        Id: unitId,
        DisplayName: unitName,
        FactionKeywords: [catalogue["@_name"] || "Aeldari"],
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
        Points: [{ ModelCount: 1, Cost: 100 }], // Default fallback or parsed cost
        StatLines: [
          {
            StatName: unitName,
            Stats: stats
          }
        ],
        Weapons: []
      });
    }
  }

  return units;
}

function main() {
  console.log(`Scanning input directory: ${inputDir}`);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(path.join(outputDir, 'Rosters'), { recursive: true });
  }

  // Find all .cat files in upstream repo
  const findCatFiles = (dir: string): string[] => {
    let results: string[] = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat && stat.isDirectory()) {
        results = results.concat(findCatFiles(filePath));
      } else if (file.endsWith('.cat')) {
        results.push(filePath);
      }
    }
    return results;
  };

  const catFiles = findCatFiles(inputDir);
  const allUnits: Unit[] = [];

  for (const file of catFiles) {
    try {
      const units = parseCatalogue(file);
      allUnits.push(...units);
    } catch (err) {
      console.error(`Error parsing ${file}:`, err);
    }
  }

  // Write DatasetDefinition.json
  const datasetDef = {
    Features: "None",
    Factions: [
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

  // Write Faction Roster JSON
  const rosterData = {
    Name: "Aeldari",
    Units: allUnits
  };

  fs.writeFileSync(
    path.join(outputDir, 'Rosters', 'Aeldari.json'),
    JSON.stringify(rosterData, null, 2)
  );

  console.log(`Dataset generated successfully in ${outputDir}`);
}

main();
