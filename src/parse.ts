import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';

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
  StatLines: Array<{
    StatName: string;
    Stats: Array<{ Id: string; Value: string }>;
  }>;
  Weapons: any[];
}

const inputDir = process.env.INPUT_DIR || './upstream-data';
const outputDir = process.env.OUTPUT_DIR || './Assets/MyGame';

function parseCatalogue(filePath: string): { factionName: string; units: Unit[] } {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  
  // Handle both XML (.cat) and any JSON inputs safely
  if (filePath.endsWith('.json')) {
    try {
      const data = JSON.parse(fileContent);
      return { factionName: data.name || path.basename(filePath, '.json'), units: data.units || [] };
    } catch {
      return { factionName: 'Unknown', units: [] };
    }
  }

  const parser = new XMLParser({ attrNodeName: "@_", ignoreAttributes: false });
  const result = parser.parse(fileContent);
  const catalogue = result.catalogue;
  if (!catalogue) return { factionName: 'Unknown', units: [] };

  const factionName = catalogue["@_name"] || "Unknown Faction";
  const units: Unit[] = [];
  const selectionEntries = catalogue.sharedSelectionEntries?.selectionEntry || [];
  const entriesArray = Array.isArray(selectionEntries) ? selectionEntries : [selectionEntries];

  for (const entry of entriesArray) {
    if (entry["@_type"] === "model" || entry["@_type"] === "unit") {
      const unitName = entry["@_name"];
      const unitId = unitName.toUpperCase().replace(/[^A-Z0-9]/g, '_');

      const profiles = entry.profiles?.profile || [];
      const profilesArray = Array.isArray(profiles) ? profiles : [profiles];
      
      const stats: Array<{ Id: string; Value: string }> = [];
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
        StatLines: [{ StatName: unitName, Stats: stats }],
        Weapons: []
      });
    }
  }

  return { factionName, units };
}

function main() {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(path.join(outputDir, 'Rosters'), { recursive: true });
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

  // Search upstream repo for catalog files (.cat or .json)
  const catFiles = [...findFiles(inputDir, '.cat'), ...findFiles(inputDir, '.json')];
  const factionsMap: { [key: string]: Unit[] } = {};
  const factionList: Array<{ Name: string; FactionKeyword: string; MainColor: string; DarkColor: string }> = [];

  for (const file of catFiles) {
    try {
      const { factionName, units } = parseCatalogue(file);
      if (units.length > 0) {
        if (!factionsMap[factionName]) {
          factionsMap[factionName] = [];
          factionList.push({
            Name: factionName,
            FactionKeyword: factionName,
            MainColor: "#315C91",
            DarkColor: "#6FA4D9"
          });
        }
        factionsMap[factionName].push(...units);
      }
    } catch (err) {
      console.error(`Failed parsing ${file}:`, err);
    }
  }

  // 1. Generate DataSetDefinition.json
  const datasetDef = {
    Features: "None",
    Factions: factionList.length > 0 ? factionList : [{ Name: "Aeldari", FactionKeyword: "Aeldari", MainColor: "#315C91", DarkColor: "#6FA4D9" }],
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

  // 2. Generate individual faction JSONs in the Rosters/ folder
  for (const [factionName, units] of Object.entries(factionsMap)) {
    const safeFileName = factionName.replace(/[^a-zA-Z0-9-_]/g, '_') + '.json';
    const rosterData = {
      Name: factionName,
      Units: units
    };
    fs.writeFileSync(
      path.join(outputDir, 'Rosters', safeFileName),
      JSON.stringify(rosterData, null, 2)
    );
  }

  console.log("Dataset normalization complete.");
}

main();
