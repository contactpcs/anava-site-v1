/**
 * ANAVA CLINICS — scripts.js
 * Vanilla JS: Navigation, FAQ accordions, Condition cards,
 * Reveal animations, Counter animation, Smooth scroll.
 */

(function () {
  'use strict';

  /* -------------------------------------------------------------------------
     Navigation — sticky scroll state
  -------------------------------------------------------------------------- */

  var nav = document.querySelector('.nav');

  function updateNavState() {
    if (!nav) return;

    /* The bar is light on every page now, so this only controls the lift
       (opaque background + shadow) once the page has moved at all. */
    if (window.scrollY > 8) {
      nav.classList.add('nav--scrolled');
      nav.classList.remove('nav--transparent');
    } else {
      nav.classList.remove('nav--scrolled');
      nav.classList.add('nav--transparent');
    }
  }

  window.addEventListener('scroll', updateNavState, { passive: true });
  updateNavState();

  /* -------------------------------------------------------------------------
     Mobile sticky CTA bar

     The hero carries its own "Book a Consultation" button, so showing the
     sticky bar at the same time repeats it and takes over the first screen.
     Keep the bar out of the way until the hero has scrolled past.
  -------------------------------------------------------------------------- */

  var ctaBar = document.querySelector('.mobile-cta-bar');
  var heroSection = document.querySelector('.hero');

  if (ctaBar && heroSection) {
    var updateCtaBar = function () {
      /* Reveal once the hero is mostly out of view. */
      var heroBottom = heroSection.getBoundingClientRect().bottom;
      if (heroBottom > 120) {
        ctaBar.classList.add('mobile-cta-bar--hidden');
      } else {
        ctaBar.classList.remove('mobile-cta-bar--hidden');
      }
    };

    window.addEventListener('scroll', updateCtaBar, { passive: true });
    window.addEventListener('resize', updateCtaBar, { passive: true });
    updateCtaBar();
  }

  /* -------------------------------------------------------------------------
     Mobile Menu
  -------------------------------------------------------------------------- */

  var navToggle = document.querySelector('.nav__toggle');
  var mobileMenu = document.querySelector('.nav__mobile-menu');
  var toggleLines = navToggle ? navToggle.querySelectorAll('.nav__toggle-line') : [];

  function openMenu() {
    mobileMenu.classList.add('open');
    navToggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    if (toggleLines.length === 3) {
      toggleLines[0].style.transform = 'translateY(7.5px) rotate(45deg)';
      toggleLines[1].style.transform = 'scaleX(0)';
      toggleLines[1].style.opacity = '0';
      toggleLines[2].style.transform = 'translateY(-7.5px) rotate(-45deg)';
    }
  }

  function closeMenu() {
    mobileMenu.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    if (toggleLines.length === 3) {
      toggleLines[0].style.transform = '';
      toggleLines[1].style.transform = '';
      toggleLines[1].style.opacity = '';
      toggleLines[2].style.transform = '';
    }
  }

  if (navToggle && mobileMenu) {
    navToggle.addEventListener('click', function () {
      mobileMenu.classList.contains('open') ? closeMenu() : openMenu();
    });

    mobileMenu.querySelectorAll('.nav__mobile-link').forEach(function (link) {
      link.addEventListener('click', closeMenu);
    });

    // Close on Escape key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && mobileMenu.classList.contains('open')) closeMenu();
    });
  }

  /* -------------------------------------------------------------------------
     Active Nav Link
  -------------------------------------------------------------------------- */

  var currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav__link').forEach(function (link) {
    var href = link.getAttribute('href');
    if (href === currentPage || (currentPage === '' && href === 'index.html')) {
      link.classList.add('nav__link--active');
    }
  });

  /* -------------------------------------------------------------------------
     FAQ Accordions
  -------------------------------------------------------------------------- */

  var faqItems = document.querySelectorAll('.faq-item');

  faqItems.forEach(function (item) {
    var btn = item.querySelector('.faq-item__btn');
    var answer = item.querySelector('.faq-item__answer');
    if (!btn || !answer) return;

    btn.addEventListener('click', function () {
      var isOpen = item.classList.contains('open');

      // Collapse all
      faqItems.forEach(function (other) {
        if (other !== item) {
          other.classList.remove('open');
          var a = other.querySelector('.faq-item__answer');
          if (a) a.style.maxHeight = null;
          var b = other.querySelector('.faq-item__btn');
          if (b) b.setAttribute('aria-expanded', 'false');
        }
      });

      // Toggle clicked
      if (isOpen) {
        item.classList.remove('open');
        answer.style.maxHeight = null;
        btn.setAttribute('aria-expanded', 'false');
      } else {
        item.classList.add('open');
        answer.style.maxHeight = answer.scrollHeight + 'px';
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });

  /* -------------------------------------------------------------------------
     Condition Cards — toggle expand
  -------------------------------------------------------------------------- */

  var conditionCards = document.querySelectorAll('.condition-card');

  conditionCards.forEach(function (card) {
    card.addEventListener('click', function () {
      var isActive = card.classList.contains('active');
      conditionCards.forEach(function (c) { c.classList.remove('active'); });
      if (!isActive) card.classList.add('active');
    });

    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        card.click();
      }
    });
  });

  /* -------------------------------------------------------------------------
     Clinic Cards — accordion expand on mobile
  -------------------------------------------------------------------------- */

  // Announcement cards have nothing to expand — their links must tap through
  var clinicCards = document.querySelectorAll('.clinic-card:not(.clinic-card--announce)');

  clinicCards.forEach(function (card) {
    card.addEventListener('click', function (e) {
      // On desktop (> 767px) don't intercept — let links work normally
      if (window.innerWidth > 767) return;
      // If clicking a link inside an already-active card, let it navigate
      if (e.target.closest('a') && card.classList.contains('active')) return;
      e.preventDefault();
      var isActive = card.classList.contains('active');
      clinicCards.forEach(function (c) { c.classList.remove('active'); });
      if (!isActive) card.classList.add('active');
    });

    card.addEventListener('keydown', function (e) {
      if (window.innerWidth > 767) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        card.click();
      }
    });
  });

  /* -------------------------------------------------------------------------
     Intersection Observer — Reveal animations
  -------------------------------------------------------------------------- */

  var reveals = document.querySelectorAll('.reveal');

  if ('IntersectionObserver' in window && reveals.length) {
    var revealObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          revealObs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    reveals.forEach(function (el) { revealObs.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('visible'); });
  }

  /* -------------------------------------------------------------------------
     Deep-link anchor alignment

     Two things break a plain `#id` landing on this site: the fixed navigation
     covers the top of the target, and any `.reveal` element above the target
     is still translated 32px down while it waits to animate in, so the page
     settles a little off from where the browser first scrolled.

     `scroll-margin-top` in the CSS handles the header. Here we reveal anything
     above the target immediately — no animation for content the visitor has
     effectively skipped past — then re-scroll once layout has settled.
  -------------------------------------------------------------------------- */

  function alignToHash(hash, smooth) {
    if (!hash || hash === '#') return;

    var target;
    try {
      target = document.querySelector(hash);
    } catch (err) {
      return; /* not a valid selector — ignore */
    }
    if (!target) return;

    var targetTop = target.getBoundingClientRect().top + window.pageYOffset;

    /* Settle everything above the target so nothing shifts under us. */
    Array.prototype.forEach.call(document.querySelectorAll('.reveal'), function (el) {
      if (el.getBoundingClientRect().top + window.pageYOffset < targetTop) {
        el.classList.add('visible');
      }
    });

    /* Recompute after the layout settles, then scroll to the corrected spot. */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var nav = document.querySelector('.nav');
        var offset = (nav ? nav.offsetHeight : 80) + 32;

        /* When the target is a card inside a section, scrolling to the card
           alone leaves the section heading stranded above the viewport, so the
           visitor lands on a card with no idea what group it belongs to. If the
           whole section still fits on screen, prefer its top instead. */
        var anchor = target;
        var section = target.closest ? target.closest('section[id]') : null;

        var top;

        if (section && section !== target &&
            section.getBoundingClientRect().height <= window.innerHeight - offset) {
          /* Section fits comfortably — show it from its heading down. */
          top = section.getBoundingClientRect().top + window.pageYOffset - offset;
        } else if (section && section !== target &&
                   section.getBoundingClientRect().height <= window.innerHeight * 1.25) {
          /* Section is only slightly too tall. Centring it keeps the heading on
             screen, which matters more than pinning the card to the top. */
          var sr = section.getBoundingClientRect();
          var slack = (window.innerHeight - offset - sr.height) / 2;
          top = sr.top + window.pageYOffset - offset - slack;
        } else {
          top = anchor.getBoundingClientRect().top + window.pageYOffset - offset;
        }

        window.scrollTo({
          top: top < 0 ? 0 : top,
          behavior: smooth ? 'smooth' : 'auto'
        });
      });
    });
  }

  if (window.location.hash) {
    /* Run after load so images and fonts have contributed their height. */
    window.addEventListener('load', function () {
      alignToHash(window.location.hash, false);
    });
    alignToHash(window.location.hash, false);
  }

  window.addEventListener('hashchange', function () {
    alignToHash(window.location.hash, true);
  });

  /* -------------------------------------------------------------------------
     Animated Counters
  -------------------------------------------------------------------------- */

  function animateCounter(el, target, suffix, duration) {
    var startTime = null;

    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      var elapsed = timestamp - startTime;
      var progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(target * eased) + suffix;
      if (progress < 1) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }

  var statNums = document.querySelectorAll('[data-count]');

  if ('IntersectionObserver' in window && statNums.length) {
    var counterObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var el = entry.target;
          animateCounter(el, parseInt(el.dataset.count, 10), el.dataset.suffix || '', 2000);
          counterObs.unobserve(el);
        }
      });
    }, { threshold: 0.5 });

    statNums.forEach(function (el) { counterObs.observe(el); });
  }

  /* -------------------------------------------------------------------------
     Smooth Scroll for anchor links
  -------------------------------------------------------------------------- */

  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var target = document.querySelector(this.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      var navH = parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--nav-height'),
        10
      ) || 80;
      var top = target.getBoundingClientRect().top + window.pageYOffset - navH - 16;
      window.scrollTo({ top: top, behavior: 'smooth' });
    });
  });

  /* -------------------------------------------------------------------------
     Contact Form — validation + EmailJS submission
  -------------------------------------------------------------------------- */

  var contactForm = document.querySelector('.contact-form');

  if (contactForm) {
    contactForm.addEventListener('submit', function (e) {
      e.preventDefault();

      var valid = true;
      contactForm.querySelectorAll('[required]').forEach(function (field) {
        field.classList.remove('error');
        if (!field.value.trim()) {
          field.classList.add('error');
          valid = false;
        }
      });

      var emailField = contactForm.querySelector('[type="email"]');
      if (emailField && emailField.value) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailField.value)) {
          emailField.classList.add('error');
          valid = false;
        }
      }

      if (!valid) return;

      var submitBtn = contactForm.querySelector('[type="submit"]');
      var origText = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) {
        submitBtn.textContent = 'Sending…';
        submitBtn.disabled = true;
      }

      var firstName = contactForm.querySelector('#first-name');
      var lastName  = contactForm.querySelector('#last-name');
      var fullName  = (firstName ? firstName.value.trim() : '') + ' ' + (lastName ? lastName.value.trim() : '');

      var templateParams = {
        from_name : fullName.trim(),
        from_email: emailField ? emailField.value.trim() : '',
        phone     : (contactForm.querySelector('#phone')     || {}).value || 'Not provided',
        condition : (contactForm.querySelector('#condition') || {}).value || 'Not specified',
        location  : (contactForm.querySelector('#location')  || {}).value || 'Not specified',
        message   : (contactForm.querySelector('#message')   || {}).value || 'No message provided'
      };

      emailjs.send('service_8ult84j', 'template_rf4848u', templateParams)
        .then(function () {
          if (submitBtn) {
            submitBtn.textContent = 'Enquiry sent — we\'ll be in touch soon';
          }
          contactForm.reset();
          setTimeout(function () {
            if (submitBtn) {
              submitBtn.textContent = origText;
              submitBtn.disabled = false;
            }
          }, 6000);
        })
        .catch(function (err) {
          console.error('EmailJS error:', err);
          if (submitBtn) {
            submitBtn.textContent = 'Something went wrong — please email us directly';
            submitBtn.disabled = false;
            setTimeout(function () {
              submitBtn.textContent = origText;
            }, 5000);
          }
        });
    });
  }

  /* -------------------------------------------------------------------------
     Eligibility check — a short, general wellbeing reflection

     Five plain-language questions. Everything runs in the browser: no answer is
     stored, sent, or persisted anywhere, which is what the section copy tells
     the visitor. The result is deliberately encouraging and never presented as
     a diagnosis — it reflects what the person said back to them and points to a
     supervised assessment.
  -------------------------------------------------------------------------- */

  var quiz = document.getElementById('quiz');

  if (quiz) {
    var QUESTIONS = [
      {
        key: 'Main concern',
        text: 'What has been weighing on you most lately?',
        options: [
          { label: 'Low mood or loss of interest', value: 'Low mood', score: 2 },
          { label: 'Anxiety, worry or feeling on edge', value: 'Anxiety', score: 2 },
          { label: 'Persistent pain', value: 'Chronic pain', score: 2 },
          { label: 'Poor sleep or constant fatigue', value: 'Sleep and fatigue', score: 2 },
          { label: 'Trouble focusing or thinking clearly', value: 'Focus and clarity', score: 2 }
        ]
      },
      {
        key: 'Duration',
        text: 'How long has it been going on?',
        options: [
          { label: 'A few weeks', value: 'A few weeks', score: 0 },
          { label: 'Several months', value: 'Several months', score: 1 },
          { label: 'One to two years', value: '1–2 years', score: 2 },
          { label: 'More than two years', value: 'Over 2 years', score: 3 }
        ]
      },
      {
        key: 'Daily life',
        text: 'How much is it affecting your day-to-day life?',
        options: [
          { label: 'Barely — I manage fine most days', value: 'Minimal impact', score: 0 },
          { label: 'Somewhat — some days are harder than others', value: 'Some impact', score: 1 },
          { label: 'A lot — work, sleep or relationships are suffering', value: 'Significant impact', score: 3 },
          { label: 'Almost everything feels harder than it should', value: 'Substantial impact', score: 4 }
        ]
      },
      {
        key: 'What you have tried',
        text: 'What have you already tried?',
        options: [
          { label: 'Nothing formal yet', value: 'Nothing yet', score: 1 },
          { label: 'Lifestyle changes — exercise, sleep, diet', value: 'Lifestyle changes', score: 1 },
          { label: 'Counselling or talking therapy', value: 'Talking therapy', score: 2 },
          { label: 'Medication', value: 'Medication', score: 3 },
          { label: 'Several of these, without lasting relief', value: 'Several approaches', score: 4 }
        ]
      },
      {
        key: 'What you want',
        text: 'What would you most like to change?',
        options: [
          { label: 'To feel more like myself again', value: 'Feeling like myself', score: 1 },
          { label: 'To feel calmer and less on edge', value: 'Feeling calmer', score: 1 },
          { label: 'To have more energy and better sleep', value: 'Energy and sleep', score: 1 },
          { label: 'To find an option I have not already tried', value: 'A new option', score: 2 }
        ]
      }
    ];

    var stepEl     = quiz.querySelector('[data-quiz-step]');
    var resultEl   = quiz.querySelector('[data-quiz-result]');
    var counterEl  = quiz.querySelector('[data-quiz-counter]');
    var questionEl = quiz.querySelector('[data-quiz-question]');
    var optionsEl  = quiz.querySelector('[data-quiz-options]');
    var progressEl = quiz.querySelector('[data-quiz-progress]');
    var progressBar = quiz.querySelector('.quiz__progress');
    var backBtn    = quiz.querySelector('[data-quiz-back]');
    var dialog     = quiz.querySelector('.quiz__dialog');
    var titleEl    = quiz.querySelector('[data-quiz-result-title]');
    var bodyEl     = quiz.querySelector('[data-quiz-result-body]');
    var summaryEl  = quiz.querySelector('[data-quiz-summary]');

    var index = 0;
    var answers = [];
    var lastFocused = null;

    function render() {
      var q = QUESTIONS[index];

      counterEl.textContent = 'Question ' + (index + 1) + ' of ' + QUESTIONS.length;
      questionEl.textContent = q.text;

      /* Count the question on screen, so step 1 already shows movement and the
         bar is full as the last answer is given. */
      var pct = Math.round(((index + 1) / QUESTIONS.length) * 100);
      progressEl.style.width = pct + '%';
      if (progressBar) progressBar.setAttribute('aria-valuenow', String(pct));

      optionsEl.innerHTML = '';
      q.options.forEach(function (opt) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'quiz__option';
        btn.textContent = opt.label;
        btn.addEventListener('click', function () { choose(opt); });
        optionsEl.appendChild(btn);
      });

      backBtn.hidden = index === 0;

      var first = optionsEl.querySelector('.quiz__option');
      if (first) first.focus();
    }

    function choose(opt) {
      answers[index] = opt;
      if (index < QUESTIONS.length - 1) {
        index++;
        render();
      } else {
        showResult();
      }
    }

    function showResult() {
      var score = answers.reduce(function (sum, a) { return sum + (a ? a.score : 0); }, 0);

      /* Three encouraging bands. Every one of them ends somewhere useful —
         the difference is how strongly an assessment is indicated. */
      var title, body;

      if (score >= 11) {
        title = 'A supervised assessment looks worthwhile';
        body = 'From what you have described, this has been going on a while and is taking a real toll — and you have already tried more than one route without lasting relief. That is exactly the situation non-invasive neuromodulation was developed for, and it is a good reason to have a proper conversation with a clinician rather than carrying on as you are. Having tried things that did not work does not mean you are out of options.';
      } else if (score >= 6) {
        title = 'There is likely more that can help';
        body = 'What you have described is real and worth taking seriously, even though you are managing. Addressing something at this stage is generally easier than waiting until it becomes more entrenched — and there are well-evidenced, non-invasive options available to you. A short consultation would tell you clearly whether neurotherapy fits your situation.';
      } else {
        title = 'A good moment to check in';
        body = 'From your answers, things sound relatively manageable right now — which is genuinely good news, and the best time to look after your wellbeing rather than the hardest. If any of this shifts, or you would simply like to understand your options before you need them, our team is happy to talk it through with no obligation.';
      }

      titleEl.textContent = title;
      bodyEl.textContent = body;

      summaryEl.innerHTML = '';
      answers.forEach(function (a, i) {
        if (!a) return;
        var wrap = document.createElement('div');
        wrap.className = 'quiz__summary-item';
        var dt = document.createElement('dt');
        dt.textContent = QUESTIONS[i].key;
        var dd = document.createElement('dd');
        dd.textContent = a.value;
        wrap.appendChild(dt);
        wrap.appendChild(dd);
        summaryEl.appendChild(wrap);
      });

      if (progressBar) progressBar.setAttribute('aria-valuenow', '100');

      stepEl.hidden = true;
      resultEl.hidden = false;
      if (titleEl) titleEl.setAttribute('tabindex', '-1');
      if (titleEl) titleEl.focus();
    }

    function reset() {
      index = 0;
      answers = [];
      resultEl.hidden = true;
      stepEl.hidden = false;
      render();
    }

    function open() {
      lastFocused = document.activeElement;
      quiz.hidden = false;
      document.body.style.overflow = 'hidden';
      reset();
    }

    function close() {
      quiz.hidden = true;
      document.body.style.overflow = '';
      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    }

    Array.prototype.forEach.call(document.querySelectorAll('[data-quiz-open]'), function (el) {
      el.addEventListener('click', open);
    });

    Array.prototype.forEach.call(quiz.querySelectorAll('[data-quiz-close]'), function (el) {
      el.addEventListener('click', close);
    });

    backBtn.addEventListener('click', function () {
      if (index > 0) { index--; render(); }
    });

    quiz.querySelector('[data-quiz-restart]').addEventListener('click', reset);

    document.addEventListener('keydown', function (e) {
      if (quiz.hidden) return;

      if (e.key === 'Escape') {
        close();
        return;
      }

      /* Keep tabbing inside the dialog while it is open. */
      if (e.key === 'Tab') {
        var focusable = dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        var visible = Array.prototype.filter.call(focusable, function (el) {
          return el.offsetParent !== null;
        });
        if (!visible.length) return;

        var first = visible[0];
        var last = visible[visible.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
  }

})();
