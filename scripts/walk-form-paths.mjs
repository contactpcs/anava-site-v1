#!/usr/bin/env node
// Walks every branching path through the synced form and checks what the
// page would send for it. Nothing is submitted.
//
//   npm run form:paths
//
// For each path it fills in answers for EVERY section, including the ones
// the path skips (as if the patient answered them and then went Back and
// changed a branching answer). It then checks that:
//   - the answers lead through exactly the expected sections
//   - every section on the path passes validation
//   - pageHistory lists the visited sections in order
//   - no field from an unvisited section is in the payload
//   - every required question on the path is in the payload
// Exits with code 1 if any check fails.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPayload, computePath, validateSection } from '../js/google-form-core.js';
import { dummyAnswers } from './lib/dummy-answers.mjs';
import { enumeratePaths } from './lib/google-form-sync.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(await readFile(path.join(ROOT, 'forms', 'neuromodulation-interest.schema.json'), 'utf8'));

const entryIdsOf = (item) => item.entryIds ?? (item.entryId != null ? [item.entryId] : []);
const sentEntryId = (key) => key.match(/^entry\.(\d+)/)?.[1];

let failures = 0;
const check = (ok, message) => {
  if (!ok) {
    failures++;
    console.log(`     ✗ ${message}`);
  }
  return ok;
};

const paths = enumeratePaths(schema);
console.log(`${schema.title}\n${paths.length} paths through ${schema.sections.length} sections\n`);

paths.forEach((p, n) => {
  const letter = String.fromCharCode(65 + n);
  const forced = new Map();
  for (const step of p.steps) {
    const [choice] = step.choices;
    if (choice) forced.set(choice.item.itemId, choice.option);
  }

  const answers = dummyAnswers(schema, {
    label: 'TEST',
    pick: (item) => (forced.has(item.itemId) ? { option: forced.get(item.itemId) } : undefined)
  });
  const route = computePath(schema, answers);
  const body = buildPayload(schema, answers, route, { fbzx: schema.fbzx });

  console.log(`${letter}. ${route.map((i) => `Section ${i + 1}`).join(' → ')} → ${p.loops ? 'loops back' : 'Submit form'}`);
  for (const step of p.steps) {
    const [choice] = step.choices;
    if (choice) {
      const label = choice.option ? (choice.option.isOther ? 'Other' : `"${choice.option.value}"`) : '(unanswered)';
      console.log(`   choosing ${label} for "${choice.item.title}"`);
    }
  }
  console.log(`   pageHistory=${body.get('pageHistory')}`);

  const visited = new Set(route);
  const visitedIds = new Set();
  const unvisitedIds = new Set();
  const requiredIds = new Set();
  for (const section of schema.sections) {
    for (const item of section.items) {
      for (const id of entryIdsOf(item)) {
        (visited.has(section.index) ? visitedIds : unvisitedIds).add(String(id));
        if (visited.has(section.index) && item.required) requiredIds.add(String(id));
      }
    }
  }
  const sentIds = new Set([...body.keys()].map(sentEntryId).filter(Boolean));
  const leaked = [...sentIds].filter((id) => unvisitedIds.has(id));
  const missing = [...requiredIds].filter((id) => !sentIds.has(id));
  const errors = route.flatMap((i) => validateSection(schema, i, answers));

  let ok = true;
  ok = check(route.join(',') === p.sections.join(','), `route ${route.join(',')} differs from expected ${p.sections.join(',')}`) && ok;
  ok = check(body.get('pageHistory') === p.sections.join(','), 'pageHistory does not match the visited sections') && ok;
  ok = check(errors.length === 0, `validation errors: ${errors.map((e) => `${e.itemId} ${e.message}`).join('; ')}`) && ok;
  ok = check(leaked.length === 0, `fields from unvisited sections were sent: ${leaked.map((id) => `entry.${id}`).join(', ')}`) && ok;
  ok = check(missing.length === 0, `required fields missing: ${missing.map((id) => `entry.${id}`).join(', ')}`) && ok;

  console.log(`   ${ok ? '✓' : '✗'} ${sentIds.size} questions sent from ${visited.size} visited sections; ` +
    `${unvisitedIds.size} questions in unvisited sections were answered and correctly left out`);
  console.log(`   payload: ${body.toString()}\n`);
});

console.log(failures ? `${failures} check(s) FAILED` : 'All paths passed.');
process.exitCode = failures ? 1 : 0;
