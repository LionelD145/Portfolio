/* ============================================================
   Portfolio — interactions
   Aucune dépendance. Tout est progressif : sans JS, le contenu
   reste lisible (thème piloté par la préférence système).
   ============================================================ */
(function () {
  'use strict';

  var root = document.documentElement;
  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Thème ---------- */
  var themeBtn = $('#theme-toggle');

  function syncThemeButton() {
    if (!themeBtn) return;
    var light = root.dataset.theme === 'light';
    themeBtn.setAttribute('aria-pressed', light ? 'true' : 'false');
    themeBtn.setAttribute('aria-label', light ? 'Basculer en thème sombre' : 'Basculer en thème clair');
  }

  syncThemeButton();

  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch (e) { /* mode privé */ }
      syncThemeButton();
    });
  }

  /* ---------- Menu mobile ---------- */
  var burger = $('#burger');
  var menu = $('#menu');

  function setMenu(open) {
    root.classList.toggle('menu-open', open);
    if (burger) {
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
    }
  }

  if (burger) {
    burger.addEventListener('click', function () {
      setMenu(!root.classList.contains('menu-open'));
    });
  }

  if (menu) {
    $$('a', menu).forEach(function (a) {
      a.addEventListener('click', function () { setMenu(false); });
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (root.classList.contains('menu-open')) {
      setMenu(false);
      if (burger) burger.focus();
    }
  });

  /* ---------- Barre de navigation ---------- */
  var nav = $('#nav');

  function onScroll() {
    if (nav) nav.classList.toggle('is-scrolled', window.scrollY > 8);
  }

  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- Section active ---------- */
  var navLinks = $$('.nav__links a');
  if ('IntersectionObserver' in window && navLinks.length) {
    var bySection = new Map();
    navLinks.forEach(function (a) {
      var href = a.getAttribute('href') || '';
      var target = href.charAt(0) === '#' ? document.getElementById(href.slice(1)) : null;
      if (target) bySection.set(target, a);
    });

    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        navLinks.forEach(function (l) { l.classList.remove('is-active'); });
        var link = bySection.get(entry.target);
        if (link) link.classList.add('is-active');
      });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });

    bySection.forEach(function (_, section) { spy.observe(section); });
  }

  /* ---------- Révélation au défilement ---------- */
  var reveals = $$('.reveal');

  if ('IntersectionObserver' in window && !reduceMotion) {
    var revealer = new IntersectionObserver(function (entries, observer) {
      entries.forEach(function (entry, i) {
        if (!entry.isIntersecting) return;
        entry.target.style.setProperty('--d', Math.min(i * 70, 280) + 'ms');
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });

    reveals.forEach(function (el) { revealer.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ---------- Filtres de projets ---------- */
  var filters = $$('.filter');
  var cards = $$('#projects-grid .card');
  var empty = $('#projects-empty');

  filters.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var family = btn.dataset.filter;
      var shown = 0;

      filters.forEach(function (b) {
        var active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
      });

      cards.forEach(function (card) {
        var visible = family === 'all' || card.dataset.cat === family;
        card.hidden = !visible;
        if (visible) shown += 1;
      });

      if (empty) empty.hidden = shown !== 0;
    });
  });

  /* ---------- Copier l'adresse e-mail ---------- */
  var toastEl = $('#toast');
  var toastTimer;

  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toastEl.classList.remove('is-visible');
    }, 2600);
  }

  $$('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.dataset.copy || '';
      var done = function () {
        var label = btn.querySelector('span');
        if (label) {
          var original = label.textContent;
          label.textContent = 'Adresse copiée';
          window.setTimeout(function () { label.textContent = original; }, 2200);
        }
        toast('Adresse e-mail copiée dans le presse-papiers');
      };

      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else {
        fallback();
      }

      function fallback() {
        var area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
        document.body.appendChild(area);
        area.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        area.remove();
        if (ok) { done(); } else { toast('Copie impossible — selectionnez le texte manuellement'); }
      }
    });
  });

  /* ---------- Halo qui suit le curseur ---------- */
  var hero = $('.hero');
  if (hero && !reduceMotion && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    hero.addEventListener('pointermove', function (e) {
      var rect = hero.getBoundingClientRect();
      hero.style.setProperty('--mx', (e.clientX - rect.left) + 'px');
      hero.style.setProperty('--my', (e.clientY - rect.top) + 'px');
    }, { passive: true });
  }

  /* ---------- Divers ---------- */
  var year = $('#year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
