#!/usr/bin/env node
// Updates positions/atc-positions.json from the GNG VoiceChannels<FIR>.txt
// exports (LF* and PAR* stations).
//
// The voice files are the source of truth for which positions exist and on
// what frequency. Everything else already in the JSON is kept: airport
// metadata, callsigns, s1_tower flags and ordering. New positions take their
// callsign from the voice file, new airports their name and position from
// runways/LF.json.
//
// Usage: node tools/voice-to-positions.mjs [--dry-run] [--out <file>] [VoiceChannels*.txt ...]
// Without files, reads every VoiceChannels*.txt at the repository root.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jsonPath = join(root, "positions/atc-positions.json");
const runwaysPath = join(root, "runways/LF.json");

const FIRS = ["LFFF", "LFEE", "LFRR", "LFBB", "LFMM"];
// Prefixes that are not an ICAO code.
const PREFIX_ICAO = { PAR: "LFFF" };
// Voice suffixes that map onto another position type.
const TYPE_ALIAS = { RMP: "GND" };
const TYPE_ORDER = ["DEL", "GND", "TWR", "DEP", "APP", "CTR"];
const RATINGS = {
  DEL: { solo: "", allowed: ["S1", "S2", "S3", "C1", "C3", "I1", "I3"] },
  GND: { solo: "", allowed: ["S1", "S2", "S3", "C1", "C3", "I1", "I3"] },
  TWR: { solo: "S1", allowed: ["S2", "S3", "C1", "C3", "I1", "I3"] },
  DEP: { solo: "S2", allowed: ["S3", "C1", "C3", "I1", "I3"] },
  APP: { solo: "S2", allowed: ["S3", "C1", "C3", "I1", "I3"] },
  CTR: { solo: "S3", allowed: ["C1", "C3", "I1", "I3"] },
};

// --- arguments ---------------------------------------------------------------

const args = process.argv.slice(2);
let dryRun = false;
let outPath = jsonPath;
const inputs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dry-run") dryRun = true;
  else if (args[i] === "--out") outPath = args[++i];
  else inputs.push(args[i]);
}
if (inputs.length === 0) {
  for (const f of readdirSync(root).sort()) {
    if (/^VoiceChannels.*\.txt$/.test(f)) inputs.push(join(root, f));
  }
}
if (inputs.length === 0) {
  console.error("No VoiceChannels*.txt file found.");
  process.exit(1);
}

// --- parse the voice files ---------------------------------------------------

/** code -> { code, icao, type, callsign, frequency, file, fileFir } */
const voice = new Map();
/** icao -> ATIS frequency */
const atis = new Map();
const warnings = [];

for (const file of inputs) {
  const fileFir = basename(file).match(/VoiceChannels(\w{4})/)?.[1];
  // GNG exports are Latin-1 with CRLF line endings.
  const lines = readFileSync(file, "latin1").split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith("AG:")) continue;
    const [, label, frequency, , id] = line.split(":");
    const space = label.indexOf(" ");
    const code = (id || (space < 0 ? label : label.slice(0, space))).trim();
    const callsign = space < 0 ? "" : label.slice(space + 1).trim();
    if (!/^(LF|PAR|LN)/.test(code)) continue;

    const parts = code.split("_");
    const icao = PREFIX_ICAO[parts[0]] ?? parts[0];
    const suffix = parts.at(-1);

    if (suffix === "ATIS") {
      atis.set(icao, frequency);
      continue;
    }
    const type = TYPE_ALIAS[suffix] ?? suffix;
    if (!RATINGS[type]) {
      warnings.push(`${code}: unknown position type ${suffix}, skipped`);
      continue;
    }
    const previous = voice.get(code);
    if (previous && previous.frequency !== frequency) {
      warnings.push(
        `${code}: ${previous.frequency} in ${basename(previous.file)} but ${frequency} in ${basename(file)}, keeping the first`,
      );
      continue;
    }
    if (!previous) voice.set(code, { code, icao, type, callsign, frequency, file, fileFir });
  }
}

// --- merge -------------------------------------------------------------------

const data = JSON.parse(readFileSync(jsonPath, "utf8"));
const runways = JSON.parse(readFileSync(runwaysPath, "utf8")).airports;
const report = { added: [], removed: [], frequency: [], atis: [], airportsAdded: [], airportsRemoved: [] };
const used = new Set();

const firByCode = new Map(data.firs.map((f) => [f.code, f]));

function newAirportPosition(v) {
  const r = RATINGS[v.type];
  return {
    icao: v.icao,
    position_code: v.code,
    callsign: v.callsign,
    frequency: v.frequency,
    solo_rating: r.solo,
    position_type: v.type,
    allowed_ratings: [...r.allowed],
  };
}

function newCentre(v) {
  const r = RATINGS.CTR;
  return {
    icao: v.icao,
    position_code: v.code,
    position_type: "CTR",
    callsign: v.callsign,
    frequency: v.frequency,
    allowed_ratings: [...r.allowed],
    solo_rating: r.solo,
  };
}

// Inserts a position after the last one of the same type, or before the
// first one of a later type.
function insertPosition(list, position) {
  const rank = TYPE_ORDER.indexOf(position.position_type);
  let at = list.length;
  for (let i = list.length - 1; i >= 0; i--) {
    const other = TYPE_ORDER.indexOf(list[i].position_type);
    if (other <= rank) {
      at = i + 1;
      break;
    }
    at = i;
  }
  list.splice(at, 0, position);
}

/** Updates `list` in place against the voice positions in `wanted`. */
function mergePositions(list, wanted, make, where) {
  const kept = [];
  for (const p of list) {
    const v = voice.get(p.position_code);
    if (!v || !wanted.includes(v)) {
      report.removed.push(`${p.position_code} (${where})`);
      continue;
    }
    if (p.frequency !== v.frequency) {
      report.frequency.push(`${p.position_code}: ${p.frequency} -> ${v.frequency}`);
      p.frequency = v.frequency;
    }
    used.add(v.code);
    kept.push(p);
  }
  const keptCodes = new Set(kept.map((p) => p.position_code));
  const added = wanted
    .filter((v) => !keptCodes.has(v.code))
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.code.localeCompare(b.code));
  for (const v of added) {
    insertPosition(kept, make(v));
    used.add(v.code);
    report.added.push(`${v.code} ${v.frequency} "${v.callsign}" (${where})`);
  }
  list.splice(0, list.length, ...kept);
}

const airportPositions = (icao) => [...voice.values()].filter((v) => v.icao === icao && v.type !== "CTR");

// Airports already in the JSON.
for (const fir of data.firs) {
  for (const airport of fir.airports) {
    mergePositions(airport.positions, airportPositions(airport.icao), newAirportPosition, `${fir.code}/${airport.icao}`);
    const freq = atis.get(airport.icao) ?? "";
    if (airport.atis !== freq) {
      report.atis.push(`${airport.icao}: "${airport.atis}" -> "${freq}"`);
      airport.atis = freq;
    }
  }
  fir.airports = fir.airports.filter((a) => {
    if (a.positions.length > 0) return true;
    report.airportsRemoved.push(`${a.icao} (${fir.code})`);
    return false;
  });
}

// Centres: a CTR belongs to the FIR its prefix names (PAR -> LFFF), or to the
// FIR whose centres already list it (LFFM in "Other").
for (const fir of data.firs) {
  const wanted = [...voice.values()].filter(
    (v) => v.type === "CTR" && (v.icao === fir.code || fir.centres.some((c) => c.position_code === v.code)),
  );
  mergePositions(fir.centres, wanted, newCentre, fir.code);
}

// Airports not in the JSON yet.
const knownAirports = new Set(data.firs.flatMap((f) => f.airports.map((a) => a.icao)));
const newAirports = new Map();
for (const v of voice.values()) {
  if (used.has(v.code)) continue;
  if (v.type === "CTR") {
    warnings.push(`${v.code}: no FIR named ${v.icao}, skipped`);
    continue;
  }
  if (knownAirports.has(v.icao)) continue;
  if (!newAirports.has(v.icao)) newAirports.set(v.icao, []);
  newAirports.get(v.icao).push(v);
}
for (const [icao, positions] of newAirports) {
  const firCode = positions[0].fileFir;
  const fir = firByCode.get(firCode);
  if (!fir) {
    warnings.push(`${icao}: no FIR ${firCode} for the new airport, skipped`);
    continue;
  }
  const info = runways[icao];
  if (!info) warnings.push(`${icao}: not in runways/LF.json, name and position left empty`);
  const airport = {
    icao,
    name: info?.name ?? "",
    city: "",
    state: "",
    lat: info?.position.lat ?? 0,
    lon: info?.position.lon ?? 0,
    atis: atis.get(icao) ?? "",
    positions: [],
  };
  mergePositions(airport.positions, positions, newAirportPosition, `${fir.code}/${icao}`);
  const at = fir.airports.findIndex((a) => a.icao > icao);
  fir.airports.splice(at < 0 ? fir.airports.length : at, 0, airport);
  report.airportsAdded.push(`${icao} "${airport.name}" in ${fir.code}`);
  if (firCode === "LFFF") warnings.push(`${icao}: new airport from the LFFF file placed in LFFF, move it to LFEE if needed`);
  warnings.push(`${icao}: city and state are empty, fill them by hand`);
}

// --- output ------------------------------------------------------------------

const section = (title, items) => {
  if (items.length === 0) return;
  console.log(`\n${title} (${items.length}):`);
  for (const i of items) console.log(`  ${i}`);
};
section("Positions added", report.added);
section("Positions removed", report.removed);
section("Frequencies changed", report.frequency);
section("ATIS changed", report.atis);
section("Airports added", report.airportsAdded);
section("Airports removed", report.airportsRemoved);
section("Warnings", warnings);

if (dryRun) {
  console.log("\nDry run, nothing written.");
} else {
  writeFileSync(outPath, JSON.stringify(data, null, 2) + "\n");
  console.log(`\nWrote ${outPath}`);
}
