// Reads a public Google Form's FB_PUBLIC_LOAD_DATA_ and turns it into the
// normalized schema that js/google-form-core.js and the form page render from.
//
// FB_PUBLIC_LOAD_DATA_ is undocumented. Everything this file relies on is
// listed in formatOutline()'s "How this outline was read" block, so a person
// can check it against the Google Form editor after every sync.

import { readFile } from 'node:fs/promises';
import { resolveNav, SUBMIT } from '../../js/google-form-core.js';

export const TYPE_NAMES = {
  0: 'short_answer',
  1: 'paragraph',
  2: 'multiple_choice',
  3: 'dropdown',
  4: 'checkboxes',
  5: 'linear_scale',
  6: 'text_block',
  7: 'grid',
  8: 'section',
  9: 'date',
  10: 'time',
  11: 'image',
  12: 'video',
  13: 'file_upload',
  18: 'rating'
};

const TYPE_LABELS = {
  short_answer: 'Short answer',
  paragraph: 'Paragraph',
  multiple_choice: 'Multiple choice',
  dropdown: 'Dropdown',
  checkboxes: 'Checkboxes',
  linear_scale: 'Linear scale',
  text_block: 'Title and description',
  grid: 'Grid',
  date: 'Date',
  time: 'Time',
  image: 'Image',
  video: 'Video',
  file_upload: 'File upload',
  rating: 'Rating'
};

// Item types whose answer-block layout hasn't been checked against a live
// form yet. They are parsed on a best-effort basis and flagged in the outline.
const UNVERIFIED_TYPES = new Set(['linear_scale', 'grid', 'date', 'time', 'rating']);

const RULE_KINDS = { 1: 'number', 2: 'text', 4: 'regex', 6: 'length', 7: 'checkbox_count' };
const RULE_OPERATORS = {
  number: { 1: 'gt', 2: 'gte', 3: 'lt', 4: 'lte', 5: 'eq', 6: 'neq', 7: 'between', 8: 'not_between', 9: 'is_number', 10: 'is_whole_number' },
  text: { 100: 'contains', 101: 'not_contains', 102: 'email', 103: 'url' },
  regex: { 299: 'contains', 300: 'not_contains', 301: 'matches', 302: 'not_matches' },
  length: { 202: 'max_length', 203: 'min_length' },
  checkbox_count: { 200: 'at_least', 201: 'at_most', 204: 'exactly' }
};
// Rule codes confirmed on a live form (each one's custom error message says
// what it checks). Other mappings are inferred and flagged in the outline.
const CONFIRMED_RULES = new Set(['text/email', 'regex/matches']);

export class FormUnavailableError extends Error {}

/* --------------------------------------------------------------------------
   Loading
   -------------------------------------------------------------------------- */

export async function loadFormHtml(source) {
  if (!/^https?:\/\//i.test(source)) {
    return { html: await readFile(source, 'utf8'), finalUrl: null };
  }
  const res = await fetch(source, {
    redirect: 'follow',
    headers: { 'accept-language': 'en-GB,en;q=0.9', 'user-agent': 'Mozilla/5.0 (form-sync)' }
  });
  return { html: await res.text(), finalUrl: res.url, status: res.status };
}

export function assertFormAvailable(html, finalUrl) {
  if ((finalUrl && finalUrl.includes('accounts.google.com')) || html.includes('ServiceLogin')) {
    throw new FormUnavailableError(
      'Google returned a sign-in page, so the form is not public.\n' +
      'In the Google Form, set Published → Responders → "Anyone with the link", then sync again.'
    );
  }
  if ((finalUrl && finalUrl.includes('/closedform')) || /is no longer accepting responses/i.test(html)) {
    throw new FormUnavailableError(
      'The form says it is no longer accepting responses.\n' +
      'Turn "Accepting responses" back on in the Google Form, then sync again.'
    );
  }
}

export function extractLoadData(html) {
  const match = html.match(/var FB_PUBLIC_LOAD_DATA_ = ([\s\S]*?);<\/script>/);
  if (!match) throw new Error('FB_PUBLIC_LOAD_DATA_ was not found in the page.');
  return {
    data: JSON.parse(match[1]),
    fbzx: html.match(/name="fbzx" value="([^"]*)"/)?.[1] ?? null,
    collectsEmail: /name="emailAddress"/.test(html)
  };
}

/* --------------------------------------------------------------------------
   Normalizing
   -------------------------------------------------------------------------- */

function normalizeRule(rule, where, warnings) {
  const [kindCode, operatorCode, args, message] = rule;
  const kind = RULE_KINDS[kindCode];
  const operator = kind && RULE_OPERATORS[kind][operatorCode];
  if (!operator) {
    warnings.push(`${where}: unknown validation rule ${JSON.stringify(rule)}. Not enforced on the page; check it in the editor.`);
    return { kind: 'unknown', operator: null, args: args ?? [], message: message ?? null, raw: [kindCode, operatorCode] };
  }
  if (!CONFIRMED_RULES.has(`${kind}/${operator}`)) {
    warnings.push(`${where}: validation read as ${kind} / ${operator}. That code mapping is inferred, so check it in the editor.`);
  }
  return { kind, operator, args: args ?? [], message: message ?? null, raw: [kindCode, operatorCode] };
}

function normalizeItem(raw, type, toNav, warnings) {
  const [itemId, title, help, typeCode, blocks] = raw;
  const where = `"${title}"`;
  const item = { itemId, type, typeCode, title: title ?? '', help: help ?? null };

  if (UNVERIFIED_TYPES.has(type)) {
    warnings.push(`${where}: ${TYPE_LABELS[type]} questions haven't been checked against a live form yet. Check this item's outline carefully.`);
  }
  if (type === 'text_block') return item;
  if (type === 'image' || type === 'video') {
    warnings.push(`${where}: ${TYPE_LABELS[type]} item. The page can't reproduce it.`);
    return { ...item, unsupported: true };
  }
  if (type === 'file_upload') {
    warnings.push(`${where}: file upload. Files can't be submitted from an external page, so this question can't be reproduced.`);
    return { ...item, required: blocks?.[0]?.[2] === 1, unsupported: true };
  }
  if (!Array.isArray(blocks) || !blocks.length) throw new Error(`${where}: no answer block found.`);

  if (type === 'grid') {
    return {
      ...item,
      entryIds: blocks.map((b) => b[0]),
      required: blocks.some((b) => b[2] === 1),
      rows: blocks.map((b) => ({ entryId: b[0], label: b[3]?.[0] ?? '', required: b[2] === 1 })),
      columns: (blocks[0][1] ?? []).map((o) => o[0]),
      multiple: blocks[0][11]?.[0] === 1
    };
  }

  const [entryId, rawOptions, required] = blocks[0];
  Object.assign(item, { entryId, required: required === 1 });

  if (['multiple_choice', 'dropdown', 'checkboxes', 'linear_scale', 'rating'].includes(type)) {
    item.options = (rawOptions ?? []).map((o) => {
      const isOther = o[4] === 1;
      return {
        value: isOther ? null : o[0],
        isOther,
        goTo: o[2] == null ? null : toNav(o[2], `${where}, option "${isOther ? 'Other' : o[0]}"`)
      };
    });
    item.branching = item.options.some((o) => o.goTo);
  }

  const rule = blocks[0][4]?.[0];
  item.validation = rule ? normalizeRule(rule, where, warnings) : null;

  if (type === 'linear_scale') {
    item.scale = {
      min: Number(item.options[0]?.value),
      max: Number(item.options[item.options.length - 1]?.value),
      minLabel: blocks[0][3]?.[0] ?? null,
      maxLabel: blocks[0][3]?.[1] ?? null
    };
  }
  if (type === 'date') {
    const flags = blocks[0][7];
    item.date = { includeTime: flags?.[0] === 1, includeYear: flags ? flags[1] === 1 : true };
    if (item.date.includeTime) warnings.push(`${where}: date-with-time questions aren't supported by the page.`);
  }
  if (type === 'time') {
    item.time = { duration: blocks[0][6]?.[0] === 1 };
    if (item.time.duration) warnings.push(`${where}: duration questions aren't supported by the page.`);
  }
  return item;
}

export function normalizeForm(data, { formId, viewUrl, submitUrl, fbzx, collectsEmail }) {
  const warnings = [];
  const form = data?.[1];
  if (!Array.isArray(form) || !Array.isArray(form[1])) {
    throw new Error('Unexpected FB_PUBLIC_LOAD_DATA_ shape: data[1][1] (the item list) is missing.');
  }
  if (collectsEmail) {
    warnings.push('The form collects respondent email addresses (Settings → Responses). The page does not send that field, so turn the setting off or add support for it.');
  }

  const sectionIndexById = new Map(
    form[1].filter((raw) => raw[3] === 8).map((raw, i) => [raw[0], i + 1])
  );

  const toNav = (raw, where) => {
    if (raw == null) return { type: 'continue', raw: null };
    if (raw === -2) return { type: 'continue', raw };
    if (raw === -3) return { type: 'submit', raw };
    if (raw === -1) {
      warnings.push(`${where}: navigation code -1, read as "Go to section 1". That code hasn't been seen on a live form yet, so check it in the editor.`);
      return { type: 'restart', raw };
    }
    if (sectionIndexById.has(raw)) {
      return { type: 'section', raw, sectionId: raw, section: sectionIndexById.get(raw) };
    }
    throw new Error(`${where}: unknown navigation code ${JSON.stringify(raw)}.`);
  };

  const sections = [{ index: 0, id: null, title: null, description: null, next: null, items: [] }];
  for (const raw of form[1]) {
    const type = TYPE_NAMES[raw[3]];
    if (!type) throw new Error(`"${raw[1]}" has unknown item type code ${raw[3]}.`);

    if (type === 'section') {
      // A section break's navigation field is the "After section" setting of
      // the section *before* it, as with Apps Script's PageBreakItem.getGoToPage().
      sections[sections.length - 1].next = toNav(raw[5], `After section ${sections.length}`);
      sections.push({
        index: sections.length,
        id: raw[0],
        title: raw[1] ?? null,
        description: raw[2] ?? null,
        next: null,
        items: []
      });
      continue;
    }
    sections[sections.length - 1].items.push(normalizeItem(raw, type, toNav, warnings));
  }
  // Nothing follows the last section, so it always submits.
  sections[sections.length - 1].next = { type: 'submit', raw: null, implicit: true };

  for (const section of sections) {
    if (section.items.filter((it) => it.branching).length > 1) {
      warnings.push(`Section ${section.index + 1} has more than one "Go to section based on answer" question. The page follows the last one answered. Check this matches Google.`);
    }
  }

  const confirmationMessage = Array.isArray(form[2]) ? form[2][0] ?? null : null;
  if (!confirmationMessage) {
    warnings.push('No custom confirmation message was found in the data. Google would show its default "Your response has been recorded."');
  }

  return {
    schema: {
      title: form[8] ?? data[3] ?? '',
      description: form[0] ?? null,
      confirmationMessage,
      formId,
      viewUrl,
      submitUrl,
      fbzx,
      sections
    },
    warnings
  };
}

/* --------------------------------------------------------------------------
   Paths
   -------------------------------------------------------------------------- */

// Every distinct route through the form. A step records which answers to
// the section's branching question lead to the next section on that route.
export function enumeratePaths(schema) {
  const paths = [];
  const walk = (index, visited, steps) => {
    const section = schema.sections[index];
    const here = [...visited, index];
    const branching = section.items.filter((it) => it.branching);
    const routes = [];

    if (!branching.length) {
      routes.push({ target: resolveNav(schema, index, section.next), choice: null });
    } else {
      const item = branching[branching.length - 1];
      for (const option of item.options) {
        routes.push({ target: resolveNav(schema, index, option.goTo ?? section.next), choice: { item, option } });
      }
      if (!item.required) {
        routes.push({ target: resolveNav(schema, index, section.next), choice: { item, option: null } });
      }
    }

    const byTarget = new Map();
    for (const { target, choice } of routes) {
      if (!byTarget.has(target)) byTarget.set(target, []);
      if (choice) byTarget.get(target).push(choice);
    }
    for (const [target, choices] of byTarget) {
      const step = { section: index, choices };
      if (target === SUBMIT || here.includes(target)) {
        paths.push({ sections: here, steps: [...steps, step], loops: target !== SUBMIT });
      } else {
        walk(target, here, [...steps, step]);
      }
    }
  };
  walk(0, [], []);
  return paths;
}

/* --------------------------------------------------------------------------
   Outline
   -------------------------------------------------------------------------- */

const quote = (s) => `"${s}"`;
const block = (text, indent) =>
  String(text).split('\n').map((line) => `${indent}| ${line}`).join('\n');
const optionLabel = (o) => (o.isOther ? 'Other: (free text)' : quote(o.value));

function sectionName(schema, index) {
  const title = schema.sections[index].title;
  return `Section ${index + 1}${title ? ` (${title})` : ''}`;
}

function navLabel(schema, fromIndex, nav) {
  const raw = nav.implicit ? 'last section' : nav.raw == null ? 'not set' : `code ${nav.raw}`;
  let label;
  if (nav.type === 'submit') label = 'Submit form';
  else if (nav.type === 'section') label = `Go to ${sectionName(schema, nav.section)}`;
  else if (nav.type === 'restart') label = 'Go to Section 1';
  else {
    const target = resolveNav(schema, fromIndex, nav);
    label = `Continue to next section → ${target === SUBMIT ? 'Submit form' : `Section ${target + 1}`}`;
  }
  return `${label}  [${raw}]`;
}

function ruleLabel(rule) {
  if (rule.kind === 'unknown') return `UNKNOWN rule ${JSON.stringify(rule.raw)}`;
  const args = rule.args?.filter((a) => a != null).map((a) => JSON.stringify(a)).join(', ');
  return `${rule.kind} / ${rule.operator}${args ? ` ${args}` : ''}  [codes ${rule.raw.join('/')}]` +
    (rule.message ? `\n           error text: ${quote(rule.message)}` : '');
}

export function formatOutline(schema, warnings) {
  const out = [];
  const total = schema.sections.reduce((n, s) => n + s.items.length, 0);

  out.push(schema.title);
  out.push(`${schema.sections.length} sections · ${total} items · form ${schema.formId}`);
  out.push('');
  out.push('Form description:');
  out.push(schema.description ? block(schema.description, '  ') : '  (none)');
  out.push('');
  out.push('Confirmation message:');
  out.push(schema.confirmationMessage ? block(schema.confirmationMessage, '  ') : '  (none found)');
  out.push('');
  out.push('How this outline was read (FB_PUBLIC_LOAD_DATA_ is undocumented):');
  out.push('  - Navigation codes: -2 = Continue to next section, -3 = Submit form, a number = the');
  out.push('    section that starts with that section-break item, not set = Continue (Google default).');
  out.push('  - "After section N" is stored on the section break that FOLLOWS section N (as in Apps');
  out.push('    Script\'s PageBreakItem.getGoToPage()). The last section has none and always submits.');
  out.push('  - An answer-based jump overrides "After section N". An option set to "Continue to next');
  out.push('    section" is taken literally (the next section in order). Lines marked ⚠ depend on this.');
  out.push('  Check each "After section" line and each "→" against the editor.');

  for (const section of schema.sections) {
    out.push('');
    out.push('='.repeat(78));
    out.push(section.index === 0
      ? `SECTION 1 of ${schema.sections.length}  (first section: shows the form title and description)`
      : `SECTION ${section.index + 1} of ${schema.sections.length}  · section break item ${section.id}`);
    if (section.title != null) out.push(`  Title: ${quote(section.title)}`);
    if (section.description) {
      out.push('  Description:');
      out.push(block(section.description, '    '));
    }

    section.items.forEach((item, i) => {
      out.push('');
      const meta = [TYPE_LABELS[item.type]];
      if (item.required !== undefined) meta.push(item.required ? 'REQUIRED' : 'optional');
      if (item.entryId !== undefined) meta.push(`entry.${item.entryId}`);
      if (item.entryIds) meta.push(item.entryIds.map((id) => `entry.${id}`).join(' '));
      if (item.branching) meta.push('GO TO SECTION BASED ON ANSWER');
      if (item.unsupported) meta.push('NOT REPRODUCIBLE');
      out.push(`  ${section.index + 1}.${i + 1}  ${meta.join(' · ')}`);
      out.push(`       ${quote(item.title)}`);
      if (item.help) {
        out.push('       Help text:');
        out.push(block(item.help, '         '));
      }
      if (item.options) {
        out.push('       Options:');
        item.options.forEach((o, n) => {
          let line = `         ${n + 1}. ${optionLabel(o)}`;
          if (o.goTo) line += `  →  ${navLabel(schema, section.index, o.goTo)}`;
          out.push(line);
          if (o.goTo?.type === 'continue' && section.next.type !== 'continue') {
            out.push(`            ⚠ "After section ${section.index + 1}" is "${navLabel(schema, section.index, section.next).replace(/\s+\[.*$/, '')}".`);
            out.push('              This option is read as going to the next section in order instead.');
          }
        });
      }
      if (item.scale) {
        out.push(`       Scale: ${item.scale.min} to ${item.scale.max} · labels ${quote(item.scale.minLabel ?? '')} / ${quote(item.scale.maxLabel ?? '')}`);
      }
      if (item.rows) {
        out.push(`       Rows: ${item.rows.map((r) => `${quote(r.label)} (entry.${r.entryId})`).join(', ')}`);
        out.push(`       Columns: ${item.columns.map(quote).join(', ')} · ${item.multiple ? 'checkbox grid' : 'one per row'}`);
      }
      if (item.validation) out.push(`       Validation: ${ruleLabel(item.validation)}`);
    });

    out.push('');
    out.push(`  After section ${section.index + 1}: ${navLabel(schema, section.index, section.next)}`);
    if (section.items.some((it) => it.branching)) {
      out.push('    (used only when the branching question above is left unanswered)');
    }
  }

  out.push('');
  out.push('='.repeat(78));
  out.push('PATHS THROUGH THE FORM');
  enumeratePaths(schema).forEach((p, n) => {
    const route = p.sections.map((i) => i + 1).join(' → ');
    out.push('');
    out.push(`  ${String.fromCharCode(65 + n)}. Section ${route} → ${p.loops ? 'LOOPS BACK' : 'Submit form'}`);
    out.push(`     pageHistory=${p.sections.join(',')}`);
    for (const step of p.steps) {
      if (!step.choices.length) continue;
      const answers = step.choices.map((c) => (c.option ? optionLabel(c.option) : '(left unanswered)')).join(' or ');
      out.push(`     when ${quote(step.choices[0].item.title)} = ${answers}`);
    }
  });

  out.push('');
  out.push('='.repeat(78));
  out.push(warnings.length ? 'WARNINGS' : 'WARNINGS: none');
  for (const w of warnings) out.push(`  - ${w}`);
  out.push('');
  return out.join('\n');
}
