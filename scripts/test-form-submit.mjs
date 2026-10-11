#!/usr/bin/env node
// Builds one complete test response from the synced schema and, with --send,
// POSTs it to the Google Form so it lands in the linked Sheet.
//
//   npm run form:test-submit                 dry run: print the path and payload only
//   npm run form:test-submit -- --send       really submit ONE response
//   node scripts/test-form-submit.mjs --send --label "TEST – delete (UI)"
//
// Answers are generated from the schema (scripts/lib/dummy-answers.mjs), never
// hard-coded: the first text field gets the label (default "TEST – delete"),
// and the route passes through as many sections as possible.

import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REQUIRED_MESSAGE,
  buildPayload,
  computePath,
  validateSection
} from '../js/google-form-core.js';
import { dummyAnswers } from './lib/dummy-answers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_PATH = path.join(ROOT, 'forms', 'neuromodulation-interest.schema.json');

const args = process.argv.slice(2);
const send = args.includes('--send');
const labelIndex = args.indexOf('--label');
const LABEL = labelIndex >= 0 ? args[labelIndex + 1] : 'TEST – delete';

const schema = JSON.parse(await readFile(SCHEMA_PATH, 'utf8'));

const answers = dummyAnswers(schema, { label: LABEL });

/* --------------------------------------------------------------------------
   Validate, encode, send
   -------------------------------------------------------------------------- */

const route = computePath(schema, answers);
const errors = route.flatMap((i) => validateSection(schema, i, answers));
if (errors.length) {
  console.error('The dummy answers fail validation, so nothing was sent:');
  for (const e of errors) console.error(`  item ${e.itemId}: ${e.message}`);
  process.exit(1);
}

const body = buildPayload(schema, answers, route, { fbzx: schema.fbzx });

console.log(`Path: ${route.map((i) => `Section ${i + 1}`).join(' → ')} → Submit form`);
console.log(`pageHistory=${route.join(',')}\n`);
console.log('Payload:');
for (const [k, v] of body) console.log(`  ${k} = ${v}`);
console.log(`\nURL-encoded (${body.toString().length} bytes):\n${body.toString()}\n`);

if (!send) {
  console.log('Dry run: nothing was sent. Add --send to submit one response.');
  process.exit(0);
}

console.log(`POST ${schema.submitUrl}`);
const res = await fetch(schema.submitUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
  body
});
const html = await res.text();
const saved = path.join(os.tmpdir(), 'google-form-test-response.html');
await writeFile(saved, html);

// The page embeds the whole form (confirmation text included) in a script
// blob, so judge only what Google actually rendered.
const rendered = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
const firstLine = schema.confirmationMessage?.split('\n')[0] ?? '';
const confirmed = Boolean(firstLine) && (rendered.includes(firstLine) || rendered.includes(escape(firstLine)));
const formShown = rendered.includes('name="pageHistory"');

console.log(`HTTP ${res.status}`);
console.log(`Page title: ${html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '(no title)'}`);
console.log(`Response saved to ${saved}`);

if (res.ok && confirmed && !formShown) {
  console.log(`SUCCESS: Google rendered the confirmation message ("${firstLine}").`);
} else {
  process.exitCode = 1;
  if (formShown) {
    const shownHistory = rendered.match(/name="pageHistory" value="([^"]*)"/)?.[1];
    const messages = [REQUIRED_MESSAGE, ...schema.sections.flatMap((s) => s.items.map((it) => it.validation?.message))]
      .filter((m) => m && (rendered.includes(m) || rendered.includes(escape(m))));
    console.log('FAILED: Google rendered a form page instead of the confirmation.');
    console.log(`  pageHistory on that page: ${shownHistory ?? '(none)'}`);
    console.log(`  error messages shown: ${messages.length ? [...new Set(messages)].join(' | ') : '(none found)'}`);
  } else {
    console.log('FAILED: neither the confirmation message nor a form page was rendered. Inspect the saved response.');
  }
}
