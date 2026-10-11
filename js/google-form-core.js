/* ==========================================================================
   ANAVA CLINICS — Google Form core
   google-form-core.js — Navigation, validation and submission encoding for a
   normalized Google Form schema (see scripts/lib/google-form-sync.mjs).

   Pure functions only: no DOM access, so the same file runs in the browser
   (the form page) and in Node (sync, test-submit and path-walk scripts).

   Answers are keyed by item ID (string):
     short_answer, paragraph, dropdown,
     linear_scale, rating ............ "value"
     multiple_choice ................. { value: "Option" | OTHER_OPTION | null, other: "" }
     checkboxes ...................... { values: ["Option", OTHER_OPTION, …], other: "" }
     grid ............................ { "<rowEntryId>": "Column" | ["Column", …] }
     date ............................ { year: "", month: "", day: "" }
     time ............................ { hour: "", minute: "" }
   ========================================================================== */

export const OTHER_OPTION = '__other_option__';
export const SUBMIT = 'submit';

// Google's own wording for an unanswered required question.
export const REQUIRED_MESSAGE = 'This is a required question';

/* --------------------------------------------------------------------------
   Navigation
   -------------------------------------------------------------------------- */

// Turns a navigation rule ({ type: continue | submit | section | restart })
// into the index of the next section, or SUBMIT.
export function resolveNav(schema, fromIndex, nav) {
  switch (nav?.type) {
    case 'submit':
      return SUBMIT;
    case 'section':
      return nav.section;
    case 'restart':
      return 0;
    case 'continue':
    default:
      return fromIndex + 1 < schema.sections.length ? fromIndex + 1 : SUBMIT;
  }
}

// The option a branching question's answer selects, or null if unanswered.
export function selectedBranchOption(item, answer) {
  if (!item.branching) return null;
  const value = item.type === 'multiple_choice' ? answer?.value : answer;
  if (value == null || value === '') return null;
  return item.options.find((o) =>
    value === OTHER_OPTION ? o.isOther : !o.isOther && o.value === value
  ) ?? null;
}

// Where "Next" goes from a section. An answered "go to section based on
// answer" question takes precedence over the section's own "After section"
// setting; an option's "Continue to next section" is taken literally.
export function nextSection(schema, index, answers) {
  const section = schema.sections[index];
  let nav = section.next;
  for (const item of section.items) {
    const option = selectedBranchOption(item, answers?.[item.itemId]);
    if (option?.goTo) nav = option.goTo;
  }
  return resolveNav(schema, index, nav);
}

// Sections the current answers lead through, from the first section to the
// one that submits. Stops early if navigation would revisit a section.
export function computePath(schema, answers) {
  const path = [0];
  for (;;) {
    const next = nextSection(schema, path[path.length - 1], answers);
    if (next === SUBMIT || path.includes(next)) return path;
    path.push(next);
  }
}

/* --------------------------------------------------------------------------
   Validation
   -------------------------------------------------------------------------- */

// Requires a dot in the domain, so it is no looser than Google's own check.
const EMAIL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;
const URL_RE = /^(https?:\/\/)?([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}(:\d+)?([/?#]\S*)?$/i;
const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

const DEFAULT_RULE_MESSAGES = {
  email: 'Must be an email',
  url: 'Must be a URL',
  number: 'Must be a number',
  whole_number: 'Must be a whole number',
  text: 'Invalid input',
  count: 'Invalid number of selections'
};

function compileRegex(pattern, operator) {
  try {
    // Google evaluates "Matches" against the whole answer.
    return operator === 'matches' || operator === 'not_matches'
      ? new RegExp(`^(?:${pattern})$`)
      : new RegExp(pattern);
  } catch {
    return null;
  }
}

// Returns an error message, or null when the value passes the rule.
// Rules the schema marks as unknown are not enforced client-side.
export function checkRule(rule, value) {
  if (!rule) return null;
  const { kind, operator, args = [] } = rule;
  const fail = (fallback) => rule.message || fallback;

  if (kind === 'regex') {
    const re = compileRegex(args[0], operator);
    if (!re) return null;
    const hit = re.test(value);
    const ok = operator === 'not_contains' || operator === 'not_matches' ? !hit : hit;
    return ok ? null : fail(DEFAULT_RULE_MESSAGES.text);
  }

  if (kind === 'text') {
    if (operator === 'email') return EMAIL_RE.test(value) ? null : fail(DEFAULT_RULE_MESSAGES.email);
    if (operator === 'url') return URL_RE.test(value) ? null : fail(DEFAULT_RULE_MESSAGES.url);
    const needle = String(args[0] ?? '');
    if (operator === 'contains') return value.includes(needle) ? null : fail(DEFAULT_RULE_MESSAGES.text);
    if (operator === 'not_contains') return value.includes(needle) ? fail(DEFAULT_RULE_MESSAGES.text) : null;
    return null;
  }

  if (kind === 'length') {
    const n = Number(args[0]);
    if (operator === 'max_length') return value.length <= n ? null : fail(DEFAULT_RULE_MESSAGES.text);
    if (operator === 'min_length') return value.length >= n ? null : fail(DEFAULT_RULE_MESSAGES.text);
    return null;
  }

  if (kind === 'number') {
    if (!NUMBER_RE.test(value)) return fail(DEFAULT_RULE_MESSAGES.number);
    const x = Number(value);
    const [a, b] = args.map(Number);
    const tests = {
      gt: x > a, gte: x >= a, lt: x < a, lte: x <= a, eq: x === a, neq: x !== a,
      between: x >= a && x <= b, not_between: x < a || x > b,
      is_number: true, is_whole_number: Number.isInteger(x)
    };
    if (!(operator in tests)) return null;
    return tests[operator] ? null : fail(DEFAULT_RULE_MESSAGES.number);
  }

  return null;
}

function checkCount(rule, count) {
  if (!rule || rule.kind !== 'checkbox_count') return null;
  const n = Number(rule.args?.[0]);
  const ok = { at_least: count >= n, at_most: count <= n, exactly: count === n }[rule.operator];
  return ok === false ? rule.message || DEFAULT_RULE_MESSAGES.count : null;
}

const text = (v) => (typeof v === 'string' ? v.trim() : '');

// Returns an error message for one item, or null if the answer can be sent.
export function validateItem(item, answer) {
  const required = (empty) => (empty && item.required ? REQUIRED_MESSAGE : null);

  switch (item.type) {
    case 'short_answer':
    case 'paragraph': {
      const v = text(answer);
      if (!v) return required(true);
      return checkRule(item.validation, v);
    }
    case 'dropdown':
    case 'linear_scale':
    case 'rating': {
      const v = text(answer);
      if (!v) return required(true);
      return item.options.some((o) => !o.isOther && o.value === v) ? null : REQUIRED_MESSAGE;
    }
    case 'multiple_choice': {
      const v = answer?.value;
      if (!v) return required(true);
      if (v === OTHER_OPTION) return text(answer.other) ? null : REQUIRED_MESSAGE;
      return item.options.some((o) => !o.isOther && o.value === v) ? null : REQUIRED_MESSAGE;
    }
    case 'checkboxes': {
      const values = Array.isArray(answer?.values) ? answer.values : [];
      if (!values.length) return required(true);
      if (values.includes(OTHER_OPTION) && !text(answer.other)) return REQUIRED_MESSAGE;
      return checkCount(item.validation, values.length);
    }
    case 'grid': {
      const missing = item.rows.some((row) => {
        const v = answer?.[row.entryId];
        return row.required && (Array.isArray(v) ? !v.length : !v);
      });
      return missing ? REQUIRED_MESSAGE : null;
    }
    case 'date': {
      const parts = ['month', 'day', ...(item.date?.includeYear === false ? [] : ['year'])];
      const filled = parts.filter((p) => text(answer?.[p]));
      if (!filled.length) return required(true);
      return filled.length === parts.length ? null : 'Invalid date';
    }
    case 'time': {
      const filled = ['hour', 'minute'].filter((p) => text(answer?.[p]));
      if (!filled.length) return required(true);
      return filled.length === 2 ? null : 'Invalid time';
    }
    default:
      return null;
  }
}

export function validateSection(schema, index, answers) {
  const errors = [];
  for (const item of schema.sections[index].items) {
    const message = validateItem(item, answers?.[item.itemId]);
    if (message) errors.push({ itemId: item.itemId, message });
  }
  return errors;
}

/* --------------------------------------------------------------------------
   Submission encoding
   -------------------------------------------------------------------------- */

// The form fields one answered item contributes. Values are only ever taken
// from the schema's own option strings, because Google silently drops any
// value that doesn't match an option character for character.
export function answerFields(item, answer) {
  const name = `entry.${item.entryId}`;
  const optionValue = (v) =>
    item.options?.find((o) => !o.isOther && o.value === v)?.value;

  switch (item.type) {
    case 'short_answer':
    case 'paragraph': {
      const v = text(answer);
      return v ? [[name, v]] : [];
    }
    case 'dropdown':
    case 'linear_scale':
    case 'rating': {
      const v = optionValue(text(answer));
      return v != null ? [[name, v]] : [];
    }
    case 'multiple_choice': {
      if (answer?.value === OTHER_OPTION && item.options.some((o) => o.isOther)) {
        return [[name, OTHER_OPTION], [`${name}.other_option_response`, text(answer.other)]];
      }
      const v = optionValue(answer?.value);
      return v != null ? [[name, v]] : [];
    }
    case 'checkboxes': {
      const chosen = new Set(Array.isArray(answer?.values) ? answer.values : []);
      const fields = [];
      for (const o of item.options) {
        if (o.isOther && chosen.has(OTHER_OPTION)) {
          fields.push([name, OTHER_OPTION], [`${name}.other_option_response`, text(answer.other)]);
        } else if (!o.isOther && chosen.has(o.value)) {
          fields.push([name, o.value]);
        }
      }
      return fields;
    }
    case 'grid': {
      const fields = [];
      for (const row of item.rows) {
        const picked = [].concat(answer?.[row.entryId] ?? []);
        for (const col of item.columns) {
          if (picked.includes(col)) fields.push([`entry.${row.entryId}`, col]);
        }
      }
      return fields;
    }
    case 'date': {
      const fields = [];
      if (item.date?.includeYear !== false && text(answer?.year)) fields.push([`${name}_year`, text(answer.year)]);
      if (text(answer?.month)) fields.push([`${name}_month`, text(answer.month)]);
      if (text(answer?.day)) fields.push([`${name}_day`, text(answer.day)]);
      return fields;
    }
    case 'time': {
      if (!text(answer?.hour) || !text(answer?.minute)) return [];
      return [[`${name}_hour`, text(answer.hour)], [`${name}_minute`, text(answer.minute)]];
    }
    default:
      return [];
  }
}

// Builds the formResponse body. Only sections on `path` contribute answers,
// so anything typed in a section the patient branched away from is dropped.
export function buildPayload(schema, answers, path, { fbzx } = {}) {
  const body = new URLSearchParams();
  for (const index of new Set(path)) {
    for (const item of schema.sections[index].items) {
      for (const [k, v] of answerFields(item, answers?.[item.itemId])) body.append(k, v);
    }
  }
  body.append('fvv', '1');
  body.append('pageHistory', path.join(','));
  if (fbzx) body.append('fbzx', fbzx);
  return body;
}
