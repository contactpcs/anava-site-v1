#!/usr/bin/env node
// Pulls the live "Neuromodulation Interest Form : Anava Clinics Pvt Ltd"
// Google Form and regenerates everything the form page renders from.
//
//   npm run form:sync                    fetch the live form, update forms/ and the page
//   npm run form:page                    no network: refresh the page from the saved
//                                        schema (after editing the form's CSS or JS)
//   node scripts/sync-neuromodulation-form.mjs ./forms/viewform.html   use a saved page source
//
// Writes, under forms/:
//   neuromodulation-interest.raw.json      FB_PUBLIC_LOAD_DATA_ exactly as Google serves it
//   neuromodulation-interest.schema.json   normalized schema (the page's only source of text)
//   neuromodulation-interest.outline.txt   readable outline; `git diff forms/` after a re-sync
// and updates neuromodulation-interest.html (meta tags, embedded
// schema, asset ?v= hashes).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateFormPage } from './lib/google-form-page.mjs';
import {
  assertFormAvailable,
  extractLoadData,
  formatOutline,
  FormUnavailableError,
  loadFormHtml,
  normalizeForm
} from './lib/google-form-sync.mjs';

const FORM_ID = '1FAIpQLSc1Ooe45dKT0cCarnkrOGZwgVdwNDnZrMKomFOpk-MtCABMpA';
const VIEW_URL = `https://docs.google.com/forms/d/e/${FORM_ID}/viewform`;
const SUBMIT_URL = `https://docs.google.com/forms/d/e/${FORM_ID}/formResponse`;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'forms', 'neuromodulation-interest');
const PAGE = path.join(ROOT, 'neuromodulation-interest.html');

const args = process.argv.slice(2);
const pageOnly = args.includes('--page-only');
const fileArg = args.find((a) => !a.startsWith('--'));
const source = fileArg ? path.resolve(fileArg) : VIEW_URL;

try {
  let schema;

  if (pageOnly) {
    schema = JSON.parse(await readFile(`${OUT}.schema.json`, 'utf8'));
  } else {
    console.log(`Reading ${source}\n`);
    const { html, finalUrl } = await loadFormHtml(source);
    assertFormAvailable(html, finalUrl);

    const { data, fbzx, collectsEmail } = extractLoadData(html);
    const normalized = normalizeForm(data, {
      formId: FORM_ID,
      viewUrl: VIEW_URL,
      submitUrl: SUBMIT_URL,
      fbzx,
      collectsEmail
    });
    schema = normalized.schema;
    const outline = formatOutline(schema, normalized.warnings);

    await mkdir(path.dirname(OUT), { recursive: true });
    await writeFile(`${OUT}.raw.json`, `${JSON.stringify(data, null, 2)}\n`);
    await writeFile(`${OUT}.schema.json`, `${JSON.stringify(schema, null, 2)}\n`);
    await writeFile(`${OUT}.outline.txt`, outline);

    console.log(outline);
    console.log(`Wrote ${path.relative(ROOT, OUT)}.{raw.json,schema.json,outline.txt}`);
    if (!fbzx) console.log('Note: no fbzx value was found on the page; submissions will be sent without it.');
  }

  const { assets } = await updateFormPage(PAGE, schema, ROOT);
  console.log(`Updated ${path.basename(PAGE)} (meta tags, embedded schema, ?v= hashes for ${assets.join(', ')})`);
} catch (err) {
  if (err instanceof FormUnavailableError) {
    console.error(`STOPPED: ${err.message}`);
  } else {
    console.error(`Sync failed: ${err.message}`);
  }
  process.exitCode = 1;
}
