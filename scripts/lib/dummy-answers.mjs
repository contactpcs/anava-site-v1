// Dummy answers for every question in a schema, generated from the schema
// itself so no question text is hard-coded. Used by test-form-submit.mjs and
// walk-form-paths.mjs.

import { OTHER_OPTION, checkRule } from '../../js/google-form-core.js';

const TEXT_CANDIDATES = ['9876543210', '+919876543210', 'test@example.com', 'https://example.com', '1', 'TEST'];

// At a branching question with no explicit pick, prefer an explicit jump to
// a section, then "continue", so the route passes through as many sections
// as possible.
const NAV_PREFERENCE = { section: 0, continue: 1, restart: 2, submit: 3 };

/**
 * @param schema  normalized form schema
 * @param label   text for the first text question (e.g. "TEST – delete")
 * @param pick    optional (item) => ({ option }) to force a choice; option null leaves it unanswered
 */
export function dummyAnswers(schema, { label = 'TEST – delete', pick } = {}) {
  const answers = {};
  let firstText = true;

  const textAnswer = (item) => {
    if (item.validation?.kind === 'text' && item.validation.operator === 'email') return 'test@example.com';
    if (item.validation && item.validation.kind !== 'unknown') {
      const fit = TEXT_CANDIDATES.find((v) => checkRule(item.validation, v) === null);
      if (!fit) throw new Error(`No dummy value satisfies the validation on "${item.title}".`);
      return fit;
    }
    if (firstText) {
      firstText = false;
      return label;
    }
    return item.type === 'paragraph' ? `${label} (automated submission test)` : 'TEST';
  };

  const choose = (item) => {
    const forced = pick?.(item);
    if (forced) return forced.option;
    if (item.branching) {
      return [...item.options].sort(
        (a, b) => NAV_PREFERENCE[a.goTo?.type ?? 'continue'] - NAV_PREFERENCE[b.goTo?.type ?? 'continue']
      )[0];
    }
    // Exercise the "Other" encoding wherever a question offers it.
    return item.options.find((o) => o.isOther) ?? item.options.find((o) => !o.isOther);
  };

  for (const section of schema.sections) {
    for (const item of section.items) {
      switch (item.type) {
        case 'short_answer':
        case 'paragraph':
          answers[item.itemId] = textAnswer(item);
          break;
        case 'dropdown':
        case 'linear_scale':
        case 'rating':
          answers[item.itemId] = choose(item)?.value ?? '';
          break;
        case 'multiple_choice': {
          const option = choose(item);
          answers[item.itemId] = !option
            ? { value: null, other: '' }
            : option.isOther
              ? { value: OTHER_OPTION, other: 'TEST other' }
              : { value: option.value, other: '' };
          break;
        }
        case 'checkboxes': {
          const values = [item.options.find((o) => !o.isOther).value];
          if (item.options.some((o) => o.isOther)) values.push(OTHER_OPTION);
          answers[item.itemId] = { values, other: 'TEST other' };
          break;
        }
        case 'grid':
          answers[item.itemId] = Object.fromEntries(
            item.rows.map((r) => [r.entryId, item.multiple ? [item.columns[0]] : item.columns[0]])
          );
          break;
        case 'date':
          answers[item.itemId] = { year: '2026', month: '1', day: '1' };
          break;
        case 'time':
          answers[item.itemId] = { hour: '10', minute: '30' };
          break;
        default:
          break;
      }
    }
  }
  return answers;
}
