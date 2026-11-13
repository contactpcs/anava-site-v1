/* ANAVA summit page — progressive enhancement only.
   Without JS (or with reduced motion) everything is simply visible. */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Share button: only shown where the Web Share API exists (most phones). */
  var share = document.getElementById('sm-share');
  if (share && navigator.share) {
    share.hidden = false;
    share.addEventListener('click', function () {
      navigator.share({
        title: 'ANAVA Clinics',
        text: 'ANAVA Clinics — non-invasive neuromodulation care, built in Pune.',
        url: location.href.split('#')[0]
      }).catch(function () {});
    });
  }

  if (reduce || !('IntersectionObserver' in window)) return;

  /* Scroll reveal */
  document.documentElement.classList.add('sm-js');
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('[data-reveal]').forEach(function (el, i) {
    el.style.setProperty('--d', (i % 4) * 80 + 'ms');
    io.observe(el);
  });
})();
