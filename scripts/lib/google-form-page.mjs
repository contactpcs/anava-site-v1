// Writes a synced form schema into the static page that renders it:
//   - the <title>, description and social-preview tags between the
//     <!-- gform:meta --> markers
//   - the schema itself, inside <script type="application/json" id="gform-schema">
//   - fresh ?v= hashes for the form's own CSS and JS, so browsers that cached
//     an older copy (the site caches css/js for a year) fetch the new one

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const escapeAttr = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The form description, on one line and cut at a word boundary.
export function summarize(text, max = 155) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;:.—–-]+$/, '')}…`;
}

function metaBlock(schema, indent) {
  const title = escapeAttr(schema.title);
  const description = escapeAttr(summarize(schema.description));
  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`
  ].map((line) => `${indent}${line}`).join('\n');
}

// JSON that is safe inside a <script> element.
const scriptJson = (value) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(new RegExp('[\\u2028\\u2029]', 'g'), (c) => `\\u${c.charCodeAt(0).toString(16)}`);

async function fileHash(file) {
  return createHash('md5').update(await readFile(file)).digest('hex').slice(0, 8);
}

export async function updateFormPage(pagePath, schema, siteRoot) {
  let html = await readFile(pagePath, 'utf8');

  const metaRe = /([ \t]*)(<!-- gform:meta[^>]*-->\r?\n)[\s\S]*?([ \t]*<!-- \/gform:meta -->)/;
  if (!metaRe.test(html)) throw new Error(`${path.basename(pagePath)} has no <!-- gform:meta --> block.`);
  html = html.replace(metaRe, (_, indent, open, close) => `${indent}${open}${metaBlock(schema, indent)}\n${close}`);

  const schemaTag = /(<script type="application\/json" id="gform-schema">)[\s\S]*?(<\/script>)/;
  if (!schemaTag.test(html)) throw new Error(`${path.basename(pagePath)} has no gform-schema script.`);
  html = html.replace(schemaTag, (_, open, close) => `${open}${scriptJson(schema)}${close}`);

  const assets = [...new Set(html.match(/\/(?:css|js)\/google-form[\w-]*\.(?:css|js)(?=\?v=)/g) ?? [])];
  for (const asset of assets) {
    const hash = await fileHash(path.join(siteRoot, asset));
    html = html.replaceAll(new RegExp(`${asset.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\?v=[0-9a-f]*`, 'g'), `${asset}?v=${hash}`);
  }

  await writeFile(pagePath, html);
  return { assets };
}
