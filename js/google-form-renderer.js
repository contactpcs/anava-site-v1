/* ==========================================================================
   ANAVA CLINICS — Google Form renderer
   google-form-renderer.js — Renders a normalized Google Form schema (see
   scripts/lib/google-form-sync.mjs) one section per screen, and submits the
   answers to the Google Form so they land in its linked Sheet.

   Holds no form-specific text or logic: every title, option and message
   comes from the schema. Wording below is limited to Google's own interface
   text (Next, Back, Submit, Choose…), which a page can override via `strings`.

   Usage:
     new GoogleFormRenderer({ schema, title, intro, card, homeHref, homeLabel }).start();
   where `title` receives the form title, `intro` the formatted form
   description and `card` the questions.
   ========================================================================== */

import {
  OTHER_OPTION,
  SUBMIT,
  buildPayload,
  nextSection,
  validateItem
} from './google-form-core.js';

const SUBMIT_TIMEOUT_MS = 20000;

const DEFAULT_STRINGS = {
  next: 'Next',
  back: 'Back',
  submit: 'Submit',
  submitting: 'Submitting…',
  requiredNote: 'Indicates required question',
  requiredSr: '(required)',
  choose: 'Choose',
  other: 'Other:',
  otherResponse: 'Other response',
  clearSelection: 'Clear selection',
  month: 'Month',
  day: 'Day',
  progress: 'Form progress',
  sendFailed: 'Your answers could not be sent. Please check your internet connection and try again. Nothing you entered has been lost.',
  tryAgain: 'Try again',
  unsupported: 'This question can only be answered on the original form.',
  openOriginal: 'Open the original form',
  defaultConfirmation: 'Your response has been recorded.'
};

// A URL, minus any punctuation that closes the sentence around it.
const URL_RE = /https?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]'"]/g;

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/* --------------------------------------------------------------------------
   DOM helpers
   -------------------------------------------------------------------------- */

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child != null && child !== false) el.append(child);
  }
  return el;
}

// Text with line breaks kept (via CSS pre-wrap) and URLs turned into links.
function richText(text) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const match of String(text).matchAll(URL_RE)) {
    if (match.index > last) frag.append(text.slice(last, match.index));
    frag.append(h('a', { href: match[0], target: '_blank', rel: 'noopener' }, match[0]));
    last = match.index + match[0].length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

// A line opening with a bullet, check mark or emoji reads as a list item.
const LIST_LINE_RE = /^\s*([-–•*]|✓\S*|\p{Extended_Pictographic}\S*)\s+(.+)$/u;
const EMOJI_START_RE = /^\s*\p{Extended_Pictographic}/u;

// Lays out free text with structure while keeping every word as written:
// blank lines split blocks, a short emoji-led first line becomes the block's
// heading, bulleted lines become lists, and other lines keep their breaks.
function formatText(text, { leadMax = 0 } = {}) {
  const frag = document.createDocumentFragment();
  const blocks = String(text).split(/\n[ \t]*\n/);

  blocks.forEach((raw, index) => {
    const lines = raw.split('\n').filter((line) => line.trim());
    if (!lines.length) return;
    const block = h('div', { class: 'gform-text__block' });
    let i = 0;

    if (lines.length > 1 && EMOJI_START_RE.test(lines[0]) && lines[0].trim().length <= 40 && !/https?:\/\//.test(lines[0])) {
      block.classList.add('gform-text__block--titled');
      block.append(h('p', { class: 'gform-text__heading' }, lines[0].trim()));
      i = 1;
    }

    let list = null;
    let para = null;
    for (; i < lines.length; i++) {
      const match = lines[i].match(LIST_LINE_RE);
      if (match) {
        para = null;
        list ??= block.appendChild(h('ul', { class: 'gform-text__list' }));
        list.append(h('li', {},
          h('span', { class: 'gform-text__marker', 'aria-hidden': 'true', text: match[1] }),
          h('span', {}, richText(match[2]))));
      } else {
        list = null;
        if (para) para.append(h('br'));
        else para = block.appendChild(h('p'));
        para.append(richText(lines[i]));
      }
    }

    const only = lines.length === 1 ? lines[0].trim() : null;
    if (only && index === 0 && only.length <= leadMax) block.classList.add('gform-text__lead');
    if (only && /^[—–]\s/.test(only)) block.classList.add('gform-text__signature');
    frag.append(block);
  });
  return frag;
}

function svg(markup) {
  const wrap = document.createElement('span');
  wrap.innerHTML = markup;
  return wrap.firstElementChild;
}

const ICON_BACK = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_DONE = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight + 2}px`;
}

// Input type, keyboard and autofill hints for a short-answer question,
// taken from its validation rule or, failing that, its wording.
function inputHints(item) {
  const rule = item.validation;
  const words = `${item.title} ${item.help ?? ''}`.toLowerCase();
  if ((rule?.kind === 'text' && rule.operator === 'email') || /\be-?mail\b/.test(words)) {
    return { type: 'email', inputmode: 'email', autocomplete: 'email', autocapitalize: 'off', spellcheck: 'false' };
  }
  if (rule?.kind === 'text' && rule.operator === 'url') {
    return { type: 'url', inputmode: 'url', autocapitalize: 'off', spellcheck: 'false' };
  }
  if (/\b(mobile|phone|whatsapp|contact number)\b/.test(words)) {
    return { type: 'tel', inputmode: 'tel', autocomplete: 'tel' };
  }
  if (rule?.kind === 'number') {
    return { type: 'text', inputmode: rule.operator === 'is_whole_number' ? 'numeric' : 'decimal' };
  }
  if (/\bname\b/.test(words) && !/\b(company|organi[sz]ation|business|school)\b/.test(words)) {
    return { type: 'text', autocomplete: 'name', autocapitalize: 'words' };
  }
  return { type: 'text' };
}

/* --------------------------------------------------------------------------
   Renderer
   -------------------------------------------------------------------------- */

export class GoogleFormRenderer {
  constructor({ schema, title, intro, card, homeHref = '/', homeLabel = 'Home', strings = {} }) {
    this.schema = schema;
    this.titleMount = title;
    this.intro = intro;
    this.card = card;
    this.homeHref = homeHref;
    this.homeLabel = homeLabel;
    this.s = { ...DEFAULT_STRINGS, ...strings };

    this.answers = {};
    this.history = [0];
    this.fields = new Map();
    this.shownProgress = 0;
    this.sending = false;
    this.done = false;

    this.storageKey = `gform-draft:${schema.formId}`;
    this.signature = schema.sections
      .map((s) => `${s.id}:${s.items.map((it) => it.itemId).join(',')}`)
      .join('|');
    this.hasRequired = schema.sections.some((s) => s.items.some((it) => it.required));

    this.progressFill = h('span', { class: 'gform__progress-fill' });
    this.progress = h('div', {
      class: 'gform__progress',
      role: 'progressbar',
      'aria-label': this.s.progress,
      'aria-valuemin': '0',
      'aria-valuemax': '100'
    }, this.progressFill);

    this.honeypot = h('input', { type: 'text', name: 'hp_website', tabindex: '-1', autocomplete: 'off' });
  }

  get current() {
    return this.history[this.history.length - 1];
  }

  start() {
    this.restoreDraft();
    this.card.classList.add('gform');
    this.card.setAttribute('tabindex', '-1');
    this.renderIntro();
    this.renderSection({ initial: true });
  }

  /* ---- Intro (form title and description) ------------------------------ */

  renderIntro() {
    const { title, description } = this.schema;
    this.titleEl = h('h1', { class: 'gform__title', tabindex: '-1', text: title });
    this.titleMount.replaceChildren(this.titleEl);
    if (description) {
      this.intro.replaceChildren(h('div', { class: 'gform-text' }, formatText(description, { leadMax: 40 })));
    } else {
      this.intro.hidden = true;
    }
  }

  // Like Google, the description belongs to the first section. The page's
  // CSS decides whether a collapsed intro still shows (e.g. as a sidebar).
  updateIntro() {
    this.intro.classList.toggle('is-collapsed', this.done || this.current !== 0);
  }

  /* ---- Sections --------------------------------------------------------- */

  renderSection({ initial = false, direction = 0 } = {}) {
    const section = this.schema.sections[this.current];
    this.fields.clear();
    this.updateIntro();

    this.headingEl = section.index > 0 && section.title
      ? h('h2', { class: 'gform__section-title', tabindex: '-1', text: section.title })
      : null;
    const head = section.index > 0 && (section.title || section.description)
      ? h('div', { class: 'gform__section-head' },
          this.headingEl,
          section.description ? h('div', { class: 'gform__section-desc gform-text' }, formatText(section.description)) : null)
      : null;

    this.alert = h('div', { class: 'gform__alert', role: 'alert', hidden: true });
    this.nextLabel = h('span');
    this.spinner = h('span', { class: 'gform__spinner', 'aria-hidden': 'true', hidden: true });
    this.nextButton = h('button', { type: 'submit', class: 'btn btn--pine gform__next' }, this.spinner, this.nextLabel);

    const back = this.history.length > 1
      ? h('button', { type: 'button', class: 'gform__back', onclick: () => this.back() }, svg(ICON_BACK), this.s.back)
      : h('span');

    this.form = h('form', {
      class: `gform__form${initial ? '' : ' gform__form--enter'}`,
      novalidate: true,
      onsubmit: (event) => {
        event.preventDefault();
        this.next();
      }
    },
      head,
      section.items.map((item) => this.renderItem(item)),
      h('div', { class: 'gform__hp', 'aria-hidden': 'true' }, h('label', {}, 'Leave this field empty', this.honeypot)),
      this.alert,
      h('div', { class: 'gform__nav' }, back, this.nextButton)
    );

    this.card.replaceChildren(
      this.progress,
      this.hasRequired
        ? h('p', { class: 'gform__required-note' }, h('span', { class: 'gform__req', 'aria-hidden': 'true', text: '* ' }), this.s.requiredNote)
        : null,
      this.form
    );

    for (const textarea of this.form.querySelectorAll('textarea')) autoGrow(textarea);
    this.updateNav();
    this.updateProgress(direction);
    if (!initial) this.focusSectionStart();
  }

  focusSectionStart() {
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
    if (this.current === 0) {
      this.titleEl.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior });
    } else {
      (this.headingEl ?? this.card).focus({ preventScroll: true });
      this.card.scrollIntoView({ block: 'start', behavior });
    }
  }

  updateNav() {
    const target = nextSection(this.schema, this.current, this.answers);
    this.nextLabel.textContent = target === SUBMIT ? this.s.submit : this.s.next;
  }

  // Share of the sections on the patient's current route already behind
  // them. It only ever moves forward when they go forward.
  updateProgress(direction) {
    let share = 1;
    if (!this.done) {
      const route = [...this.history];
      for (let i = this.current; ;) {
        const next = nextSection(this.schema, i, this.answers);
        if (next === SUBMIT || route.includes(next)) break;
        route.push(next);
        i = next;
      }
      share = (this.history.length - 1) / route.length;
    }
    this.shownProgress = direction > 0 ? Math.max(this.shownProgress, share) : share;
    this.progressFill.style.transform = `scaleX(${Math.max(this.shownProgress, 0.04)})`;
    this.progress.setAttribute('aria-valuenow', String(Math.round(this.shownProgress * 100)));
  }

  /* ---- Questions -------------------------------------------------------- */

  renderItem(item) {
    const id = `gf-${item.itemId}`;
    const helpId = item.help ? `${id}-help` : null;
    const errorId = `${id}-error`;
    const describedBy = [helpId, errorId].filter(Boolean).join(' ');
    const help = item.help ? h('p', { class: 'gform__help', id: helpId }, richText(item.help)) : null;
    const error = h('p', { class: 'gform__error', id: errorId, hidden: true });
    const field = { item, error, controls: [] };

    const title = (group) => [
      item.title,
      item.required ? h('span', { class: 'gform__req gform__req--after', 'aria-hidden': 'true', text: '*' }) : null,
      item.required && group ? h('span', { class: 'sr-only', text: ` ${this.s.requiredSr}` }) : null
    ];

    const register = (root) => {
      field.root = root;
      this.fields.set(String(item.itemId), field);
      return root;
    };

    switch (item.type) {
      case 'text_block':
        return h('div', { class: 'gform__item' },
          item.title ? h('h3', { class: 'gform__block-title', text: item.title }) : null,
          help);

      case 'image':
      case 'video':
      case 'file_upload':
        return h('div', { class: 'gform__item gform__unsupported' },
          h('p', { class: 'gform__label' }, title(false)),
          h('p', { class: 'gform__help' }, `${this.s.unsupported} `,
            h('a', { href: this.schema.viewUrl, target: '_blank', rel: 'noopener', text: this.s.openOriginal })));

      case 'short_answer':
      case 'paragraph': {
        const paragraph = item.type === 'paragraph';
        const control = paragraph
          ? h('textarea', { class: 'form-textarea gform__textarea', id, rows: '3' })
          : h('input', { class: 'form-input gform__input', id, ...inputHints(item) });
        control.setAttribute('aria-describedby', describedBy);
        if (item.required) control.setAttribute('aria-required', 'true');
        control.value = this.answers[item.itemId] ?? '';
        control.addEventListener('input', () => {
          if (paragraph) autoGrow(control);
          this.setAnswer(item, control.value);
        });
        field.controls.push(control);
        return register(h('div', { class: 'gform__item' },
          h('label', { class: 'gform__label', for: id }, title(false)), help, control, error));
      }

      case 'dropdown': {
        const select = h('select', { class: 'form-select gform__select', id, 'aria-describedby': describedBy },
          h('option', { value: '', text: this.s.choose }),
          item.options.filter((o) => !o.isOther).map((o) => h('option', { value: o.value, text: o.value })));
        if (item.required) select.setAttribute('aria-required', 'true');
        select.value = this.answers[item.itemId] ?? '';
        select.addEventListener('change', () => this.setAnswer(item, select.value));
        field.controls.push(select);
        return register(h('div', { class: 'gform__item' },
          h('label', { class: 'gform__label', for: id }, title(false)), help, select, error));
      }

      case 'multiple_choice':
      case 'checkboxes':
        return register(this.renderChoices(item, field, { id, describedBy, title: title(true), help, error }));

      case 'linear_scale':
      case 'rating':
        return register(this.renderScale(item, field, { id, describedBy, title: title(true), help, error }));

      case 'grid':
        return register(this.renderGrid(item, field, { id, describedBy, title: title(true), help, error }));

      case 'date':
      case 'time':
        return register(this.renderDateTime(item, field, { id, describedBy, title: title(true), help, error }));

      default:
        return null;
    }
  }

  renderChoices(item, field, { id, describedBy, title, help, error }) {
    const multi = item.type === 'checkboxes';
    const answer = this.answers[item.itemId] ?? (multi ? { values: [], other: '' } : { value: null, other: '' });
    const name = `${id}-choice`;
    const optionEls = [];
    let otherInput = null;

    const sync = () => {
      for (const { el, input } of optionEls) el.classList.toggle('is-selected', input.checked);
      if (clear) clear.hidden = !optionEls.some(({ input }) => input.checked);
    };

    const read = () => {
      const checked = optionEls.filter(({ input }) => input.checked).map(({ input }) => input.value);
      const other = otherInput?.value ?? '';
      return multi ? { values: checked, other } : { value: checked[0] ?? null, other };
    };

    const options = item.options.map((option, n) => {
      const inputId = `${id}-${n}`;
      const value = option.isOther ? OTHER_OPTION : option.value;
      const checked = multi ? answer.values?.includes(value) : answer.value === value;
      const input = h('input', {
        class: 'gform__control',
        type: multi ? 'checkbox' : 'radio',
        id: inputId,
        name,
        value,
        checked,
        'aria-describedby': describedBy
      });
      field.controls.push(input);

      input.addEventListener('change', () => {
        sync();
        this.setAnswer(item, read());
        if (option.isOther && input.checked) otherInput.focus();
      });

      let el;
      if (option.isOther) {
        otherInput = h('input', {
          class: 'gform__other-input',
          type: 'text',
          'aria-label': this.s.otherResponse,
          'aria-describedby': describedBy
        });
        otherInput.value = answer.other ?? '';
        // Typing an "Other" answer selects "Other", as on Google Forms.
        otherInput.addEventListener('input', () => {
          if (otherInput.value.trim() && !input.checked) {
            input.checked = true;
            sync();
          }
          this.setAnswer(item, read());
        });
        el = h('label', { class: 'gform__option gform__option--other', for: inputId },
          input, h('span', { class: 'gform__option-text', text: this.s.other }), otherInput);
      } else {
        el = h('label', { class: 'gform__option', for: inputId },
          input, h('span', { class: 'gform__option-text', text: option.value }));
      }
      optionEls.push({ el, input });
      return el;
    });

    // Google offers "Clear selection" on optional single-choice questions.
    const clear = !multi && !item.required
      ? h('button', {
          type: 'button',
          class: 'gform__clear',
          onclick: () => {
            for (const { input } of optionEls) input.checked = false;
            sync();
            this.setAnswer(item, read());
          }
        }, this.s.clearSelection)
      : null;

    sync();
    return h('fieldset', { class: 'gform__item', 'aria-describedby': describedBy },
      h('legend', { class: 'gform__label' }, title),
      help,
      h('div', { class: 'gform__options' }, options),
      clear,
      error);
  }

  renderScale(item, field, { id, describedBy, title, help, error }) {
    const answer = this.answers[item.itemId] ?? '';
    const values = item.options.filter((o) => !o.isOther).map((o) => o.value);
    const name = `${id}-scale`;
    const options = values.map((value, n) => {
      const edgeLabel = n === 0 ? item.scale?.minLabel : n === values.length - 1 ? item.scale?.maxLabel : null;
      const input = h('input', {
        class: 'gform__control',
        type: 'radio',
        name,
        value,
        checked: answer === value,
        'aria-label': edgeLabel ? `${value} (${edgeLabel})` : value,
        'aria-describedby': describedBy
      });
      input.addEventListener('change', () => this.setAnswer(item, value));
      field.controls.push(input);
      return h('label', { class: 'gform__scale-option' }, input, h('span', { class: 'gform__scale-value', 'aria-hidden': 'true', text: value }));
    });
    const labels = item.scale && (item.scale.minLabel || item.scale.maxLabel)
      ? h('div', { class: 'gform__scale-labels', 'aria-hidden': 'true' },
          h('span', { text: item.scale.minLabel ?? '' }), h('span', { text: item.scale.maxLabel ?? '' }))
      : null;
    return h('fieldset', { class: 'gform__item', 'aria-describedby': describedBy },
      h('legend', { class: 'gform__label' }, title), help,
      h('div', { class: 'gform__scale' }, options), labels, error);
  }

  renderGrid(item, field, { id, describedBy, title, help, error }) {
    const answer = this.answers[item.itemId] ?? {};
    const rows = item.rows.map((row) => {
      const name = `${id}-${row.entryId}`;
      const picked = [].concat(answer[row.entryId] ?? []);
      const optionEls = [];
      const chips = item.columns.map((column, n) => {
        const input = h('input', {
          class: 'gform__control',
          type: item.multiple ? 'checkbox' : 'radio',
          id: `${name}-${n}`,
          name,
          value: column,
          checked: picked.includes(column),
          'aria-describedby': describedBy
        });
        field.controls.push(input);
        const el = h('label', { class: 'gform__option', for: `${name}-${n}` }, input, h('span', { class: 'gform__option-text', text: column }));
        el.classList.toggle('is-selected', input.checked);
        optionEls.push({ el, input });
        input.addEventListener('change', () => {
          for (const o of optionEls) o.el.classList.toggle('is-selected', o.input.checked);
          const chosen = optionEls.filter((o) => o.input.checked).map((o) => o.input.value);
          const next = { ...(this.answers[item.itemId] ?? {}) };
          next[row.entryId] = item.multiple ? chosen : chosen[0] ?? null;
          this.setAnswer(item, next);
        });
        return el;
      });
      return h('fieldset', { class: 'gform__grid-row' },
        h('legend', {}, row.label, row.required ? h('span', { class: 'gform__req gform__req--after', 'aria-hidden': 'true', text: '*' }) : null),
        h('div', { class: 'gform__chips' }, chips));
    });
    return h('fieldset', { class: 'gform__item', 'aria-describedby': describedBy },
      h('legend', { class: 'gform__label' }, title), help, rows, error);
  }

  renderDateTime(item, field, { id, describedBy, title, help, error }) {
    const answer = this.answers[item.itemId] ?? {};
    const pad = (v) => String(v ?? '').padStart(2, '0');
    let controls;

    if (item.type === 'time') {
      const input = h('input', { class: 'form-input', type: 'time', id, 'aria-describedby': describedBy });
      if (answer.hour) input.value = `${pad(answer.hour)}:${pad(answer.minute)}`;
      input.addEventListener('input', () => {
        const [hour = '', minute = ''] = input.value.split(':');
        this.setAnswer(item, { hour, minute });
      });
      controls = [input];
    } else if (item.date?.includeYear !== false) {
      const input = h('input', { class: 'form-input', type: 'date', id, 'aria-describedby': describedBy });
      if (answer.year) input.value = `${answer.year}-${pad(answer.month)}-${pad(answer.day)}`;
      input.addEventListener('input', () => {
        const [year = '', month = '', day = ''] = input.value.split('-');
        this.setAnswer(item, { year, month: month && String(Number(month)), day: day && String(Number(day)) });
      });
      controls = [input];
    } else {
      const part = (key, label, max) => {
        const input = h('input', {
          class: 'form-input', type: 'text', inputmode: 'numeric', maxlength: '2',
          'aria-label': label, placeholder: label, 'aria-describedby': describedBy
        });
        input.value = answer[key] ?? '';
        input.addEventListener('input', () => {
          const value = input.value.replace(/\D/g, '');
          const n = Number(value);
          this.setAnswer(item, { ...(this.answers[item.itemId] ?? {}), [key]: value && n >= 1 && n <= max ? String(n) : '' });
        });
        return input;
      };
      controls = [part('month', this.s.month, 12), part('day', this.s.day, 31)];
    }

    field.controls.push(...controls);
    return h('fieldset', { class: 'gform__item', 'aria-describedby': describedBy },
      h('legend', { class: 'gform__label' }, title), help,
      h('div', { class: 'gform__datetime' }, controls), error);
  }

  /* ---- Answers and validation ------------------------------------------ */

  setAnswer(item, value) {
    this.answers[item.itemId] = value;
    if (this.fields.get(String(item.itemId))?.root.classList.contains('has-error')) {
      this.showError(item, validateItem(item, value));
    }
    if (item.branching) {
      this.updateNav();
    }
    this.saveDraft();
  }

  showError(item, message) {
    const field = this.fields.get(String(item.itemId));
    if (!field) return;
    field.error.textContent = message ?? '';
    field.error.hidden = !message;
    field.root.classList.toggle('has-error', Boolean(message));
    for (const control of field.controls) {
      if (message) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
    }
  }

  // Shows every error in the current section; returns the first failing field.
  validateCurrent() {
    let first = null;
    for (const field of this.fields.values()) {
      const message = validateItem(field.item, this.answers[field.item.itemId]);
      this.showError(field.item, message);
      if (message && !first) first = field;
    }
    return first;
  }

  focusField(field) {
    const target = field.controls.find((c) => c.checked) ?? field.controls[0];
    target?.focus({ preventScroll: true });
    field.root.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  /* ---- Navigation ------------------------------------------------------- */

  next() {
    if (this.sending || this.done) return;
    const invalid = this.validateCurrent();
    if (invalid) {
      this.focusField(invalid);
      return;
    }
    const target = nextSection(this.schema, this.current, this.answers);
    if (target === SUBMIT) {
      this.submit();
      return;
    }
    this.history.push(target);
    this.saveDraft();
    this.renderSection({ direction: 1 });
  }

  back() {
    if (this.sending || this.history.length < 2) return;
    this.history.pop();
    this.saveDraft();
    this.renderSection({ direction: -1 });
  }

  /* ---- Submission ------------------------------------------------------- */

  setSending(sending) {
    this.sending = sending;
    this.nextButton.disabled = sending;
    this.nextButton.setAttribute('aria-busy', String(sending));
    this.spinner.hidden = !sending;
    if (sending) this.nextLabel.textContent = this.s.submitting;
    else this.updateNav();
  }

  async submit() {
    if (this.sending) return;

    // A draft restored from an older visit may skip a check, so look at every
    // section on the route once more before sending.
    for (let n = 0; n < this.history.length; n++) {
      const section = this.schema.sections[this.history[n]];
      if (section.items.some((it) => validateItem(it, this.answers[it.itemId]))) {
        if (n !== this.history.length - 1) {
          this.history = this.history.slice(0, n + 1);
          this.renderSection({ direction: -1 });
        }
        const invalid = this.validateCurrent();
        if (invalid) this.focusField(invalid);
        return;
      }
    }

    // Bots fill in every field, people never see this one: pretend to succeed.
    if (this.honeypot.value) {
      this.finish();
      return;
    }

    this.alert.hidden = true;
    this.setSending(true);
    const body = buildPayload(this.schema, this.answers, this.history, { fbzx: this.schema.fbzx });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);
    try {
      // Google sends no CORS headers, so the response is opaque: a request
      // that completes is the only success signal a browser can get.
      await fetch(this.schema.submitUrl, { method: 'POST', mode: 'no-cors', body, signal: controller.signal });
      this.clearDraft();
      this.finish();
    } catch {
      this.setSending(false);
      this.alert.replaceChildren(
        h('p', { text: this.s.sendFailed }),
        h('button', { type: 'button', class: 'btn btn--outline-pine gform__next', style: 'margin-top: var(--space-4);', onclick: () => this.submit() }, this.s.tryAgain)
      );
      this.alert.hidden = false;
      this.alert.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    } finally {
      clearTimeout(timer);
    }
  }

  finish() {
    this.sending = false;
    this.done = true;
    this.updateIntro();
    this.updateProgress(1);
    const done = h('div', { class: 'gform__done', tabindex: '-1' },
      h('span', { class: 'gform__done-icon' }, svg(ICON_DONE)),
      h('div', { class: 'gform__confirmation gform-text' }, formatText(this.schema.confirmationMessage || this.s.defaultConfirmation, { leadMax: 60 })),
      h('a', { class: 'btn btn--pine gform__home', href: this.homeHref, text: this.homeLabel }));
    this.card.replaceChildren(this.progress, done);
    done.focus({ preventScroll: true });
    this.card.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  /* ---- Draft (survives switching to WhatsApp and back) ------------------ */

  saveDraft() {
    if (this.done) return;
    try {
      sessionStorage.setItem(this.storageKey, JSON.stringify({
        signature: this.signature,
        answers: this.answers,
        history: this.history
      }));
    } catch {
      // Storage can be unavailable (private mode, blocked site data).
    }
  }

  restoreDraft() {
    try {
      const draft = JSON.parse(sessionStorage.getItem(this.storageKey) ?? 'null');
      if (!draft || draft.signature !== this.signature) return;
      this.answers = draft.answers && typeof draft.answers === 'object' ? draft.answers : {};
      const count = this.schema.sections.length;
      const history = Array.isArray(draft.history) ? draft.history : [];
      if (history[0] === 0 && history.every((i) => Number.isInteger(i) && i >= 0 && i < count)) {
        this.history = history;
      }
    } catch {
      // A missing or unreadable draft just means a fresh start.
    }
  }

  clearDraft() {
    try {
      sessionStorage.removeItem(this.storageKey);
    } catch {
      // Nothing to clear.
    }
  }
}
