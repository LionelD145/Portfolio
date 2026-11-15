/* Interface d'administration — JavaScript natif, aucune dépendance.
   Les données ne passent jamais par innerHTML : tout est construit avec le DOM. */
(function () {
  'use strict';

  /* ============================================================
     Utilitaires
     ============================================================ */
  var app = document.getElementById('app');

  function h(tag, props) {
    var el = document.createElement(tag);
    var kids = Array.prototype.slice.call(arguments, 2);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = true;
      else el.setAttribute(k, v === true ? '' : v);
    });
    (function add(list) {
      list.forEach(function (kid) {
        if (kid === null || kid === undefined || kid === false) return;
        if (Array.isArray(kid)) add(kid);
        else el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
      });
    })(kids);
    return el;
  }

  function api(method, path, body, raw) {
    var opts = { method: method, credentials: 'same-origin', headers: { 'x-requested-with': 'portfolio-admin' } };
    if (raw) { opts.body = raw; opts.headers['content-type'] = 'application/octet-stream'; }
    else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['content-type'] = 'application/json'; }
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || 'Erreur ' + res.status);
          err.status = res.status;
          if (res.status === 401 && state.content) { state.content = null; showLogin('Session expirée, reconnectez-vous.'); }
          throw err;
        }
        return data;
      });
    });
  }

  var toastTimer;
  function toast(message, kind, long) {
    var box = document.getElementById('toast');
    if (!box) { box = h('div', { id: 'toast', role: 'status' }); document.body.append(box); }
    box.className = 'toast is-visible ' + (kind || '');
    box.replaceChildren(typeof message === 'string' ? document.createTextNode(message) : message);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove('is-visible'); }, long ? 9000 : 3500);
  }

  var state = { content: null, rev: '', dirty: false, tab: 'general', lastField: null };

  function touch() {
    if (!state.dirty) {
      state.dirty = true;
      var s = document.getElementById('status');
      if (s) { s.textContent = 'Modifications non enregistrées'; s.className = 'status is-dirty'; }
    }
  }

  window.addEventListener('beforeunload', function (e) {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ============================================================
     Connexion
     ============================================================ */
  function showLogin(message) {
    var input = h('input', { type: 'password', id: 'pw', autocomplete: 'current-password', required: true, 'aria-label': 'Mot de passe' });
    var error = h('p', { class: 'error', role: 'alert' }, message || '');
    var form = h('form', { class: 'login', onsubmit: function (e) {
      e.preventDefault();
      error.textContent = '';
      api('POST', '/api/login', { password: input.value }).then(boot).catch(function (err) { error.textContent = err.message; input.select(); });
    } },
    h('h1', null, 'Administration'),
    h('p', { class: 'muted' }, 'Connectez-vous pour modifier le portfolio.'),
    h('label', { for: 'pw' }, 'Mot de passe'), input,
    h('button', { class: 'btn btn--primary', type: 'submit' }, 'Se connecter'),
    error);
    app.replaceChildren(h('main', { class: 'center' }, form));
    input.focus();
  }

  function showNotConfigured() {
    app.replaceChildren(h('main', { class: 'center' }, h('div', { class: 'login' },
      h('h1', null, 'Mot de passe à définir'),
      h('p', null, 'Aucun mot de passe n\'est encore défini pour cette administration. Sur la machine qui héberge le site, lancez :'),
      h('pre', null, 'npm run password'),
      h('p', { class: 'muted' }, 'Puis rechargez cette page. (Chez un hébergeur : variable d\'environnement ADMIN_PASSWORD.)'))));
  }

  /* ============================================================
     Définition des formulaires
     ============================================================ */
  var MARK = 'Mise en forme : {hl|texte} = mot mis en valeur · {br} = retour à la ligne · {code|texte} = code.';
  var NBSP = 'Pour garder un « : » ou « ? » collé au mot, utilisez le bouton « Espace insécable » en haut.';

  var T = function (k, label, o) { return Object.assign({ type: 'text', k: k, label: label }, o); };
  var A = function (k, label, o) { return Object.assign({ type: 'area', k: k, label: label, rows: 3 }, o); };
  var U = function (k, label, o) { return Object.assign({ type: 'text', k: k, label: label, placeholder: 'https://…  ou  #section', mono: true }, o); };
  var B = function (k, label, o) { return Object.assign({ type: 'bool', k: k, label: label }, o); };
  var L = function (k, label, o) { return Object.assign({ type: 'lines', k: k, label: label, hint: 'Une entrée par ligne.' }, o); };
  var G = function (k, title, fields, o) { return Object.assign({ type: 'group', k: k, title: title, fields: fields }, o); };
  var LIST = function (k, label, item, o) { return Object.assign({ type: 'list', k: k, label: label, item: item }, o); };
  var IMG = function (k, label, o) { return Object.assign({ type: 'image', k: k, label: label }, o); };
  var PATH = function (k, label, kind, o) { return Object.assign({ type: 'path', k: k, label: label, kind: kind }, o); };
  var HEAD = function (lede) {
    return G('head', 'Titre de la section', [
      T('num', 'Numéro', { short: true }), T('eyebrow', 'Étiquette'), T('title', 'Titre')
    ].concat(lede ? [A('lede', 'Texte d\'introduction', { hint: NBSP })] : []));
  };

  var TABS = [
    { id: 'general', label: 'Général & SEO', root: function (c) { return c; }, fields: [
      G('site', 'Page et référencement (Google)', [
        T('title', 'Titre de la page'), A('description', 'Description (160 caractères idéalement)'),
        T('author', 'Auteur'), U('canonical', 'Adresse finale du site (URL canonique)')
      ]),
      G('site', 'Partage sur les réseaux sociaux', [
        T('ogTitle', 'Titre du partage'), A('ogDescription', 'Description du partage'),
        PATH('ogImage', 'Image de partage (1200 × 630 conseillé)', 'image'), T('ogImageAlt', 'Texte alternatif de l\'image'),
        PATH('favicon', 'Icône de l\'onglet (favicon)', 'image')
      ]),
      G('site', 'Marque (en haut à gauche)', [
        T('brandMark', 'Monogramme', { short: true }), T('brandName', 'Nom affiché'), T('brandAria', 'Libellé accessible du lien')
      ]),
      G('site', 'CV téléchargeable', [
        PATH('cvFile', 'Fichier PDF du CV (laisser vide pour masquer les boutons)', 'doc'), T('cvDownloadName', 'Nom du fichier téléchargé')
      ]),
      G('nav', 'Menu de navigation', [
        LIST('links', 'Liens du menu', [T('label', 'Texte'), U('href', 'Cible', { placeholder: '#projets' })],
          { add: function () { return { label: 'Nouveau', href: '#' }; }, title: function (i) { return i.label; }, max: 8 }),
        T('cta', 'Texte du bouton « Me contacter »')
      ])
    ] },

    { id: 'hero', label: 'Accueil', root: function (c) { return c.hero; }, fields: [
      T('badge', 'Pastille de disponibilité'),
      A('title', 'Grand titre', { hint: MARK + ' ' + NBSP }),
      A('lede', 'Texte d\'accroche', { rows: 4, hint: NBSP }),
      G('primary', 'Bouton principal', [T('label', 'Texte'), U('href', 'Lien', { placeholder: '#projets' })]),
      G('secondary', 'Bouton secondaire', [T('label', 'Texte'), U('href', 'Lien', { placeholder: '#contact' })]),
      T('cvLabel', 'Texte du bouton CV'),
      LIST('facts', 'Informations clés', [T('label', 'Intitulé'), T('value', 'Valeur')],
        { add: function () { return { label: 'Nouveau', value: '' }; }, title: function (i) { return i.label + ' — ' + i.value; }, max: 6 }),
      L('chips', 'Pastilles sous le terminal'),
      G('console', 'Terminal (carte de droite)', [
        T('title', 'Barre de titre'), A('aria', 'Description pour lecteurs d\'écran', { rows: 3 }),
        LIST('lines', 'Lignes', [
          { type: 'select', k: 'kind', label: 'Type de ligne', rerender: true, options: [['cmd', 'Commande ($ …)'], ['out', 'Résultat']] },
          T('cmd', 'Commande', { show: function (i) { return i.kind === 'cmd'; } }),
          T('arg', 'Argument (facultatif)', { show: function (i) { return i.kind === 'cmd'; } }),
          T('text', 'Texte', { show: function (i) { return i.kind === 'out'; },
            hint: 'Couleurs : {dim|·} {cm|# commentaire} {ok|▪} · {caret} = curseur clignotant.' })
        ], { add: function () { return { kind: 'out', cmd: '', arg: '', text: '' }; },
          title: function (i) { return i.kind === 'cmd' ? '$ ' + i.cmd + ' ' + i.arg : i.text; }, max: 30 })
      ])
    ] },

    { id: 'marquee', label: 'Technologies', root: function (c) { return c; }, fields: [
      L('marquee', 'Bandeau défilant des technologies', { rows: 14, hint: 'Une technologie par ligne, dans l\'ordre d\'affichage.' })
    ] },

    { id: 'projects', label: 'Projets', root: function (c) { return c.projects; }, fields: [
      HEAD(true),
      G('featured', 'Projet à la une', [
        B('enabled', 'Afficher le projet à la une'),
        T('eyebrow', 'Étiquette'), T('title', 'Nom du projet'), A('description', 'Description', { rows: 4, hint: NBSP }),
        L('bullets', 'Points clés'), L('tags', 'Technologies'),
        IMG('image', 'Capture principale (ordinateur)'), IMG('phone', 'Capture mobile (facultative)'),
        T('note', 'Note sous le projet'), T('noteLinkLabel', 'Texte du lien de la note'), U('noteLinkHref', 'Lien de la note', { placeholder: '#contact' })
      ]),
      T('subtitle', 'Titre « autres réalisations »'), T('allLabel', 'Libellé du filtre « tout »'), T('emptyText', 'Message si une famille est vide'),
      LIST('categories', 'Familles de projets (filtres)', [
        T('id', 'Identifiant (minuscules, sans espace)', { mono: true }), T('label', 'Nom du filtre')
      ], { add: function () { return { id: 'nouveau', label: 'Nouveau' }; }, title: function (i) { return i.label; }, open: true, max: 10 }),
      LIST('cards', 'Autres réalisations', [
        { type: 'select', k: 'category', label: 'Famille', options: function () { return state.content.projects.categories.map(function (c) { return [c.id, c.label]; }); } },
        T('chip', 'Étiquette sur la carte', { hint: 'Ex. « Web », « Outil ».' }),
        T('title', 'Nom'), T('sub', 'Sous-titre'), A('description', 'Description', { rows: 4, hint: NBSP }),
        L('tags', 'Technologies'),
        IMG('image', 'Capture (facultative)'),
        LIST('links', 'Liens (Démo, Code…)', [T('label', 'Texte'), U('url', 'Adresse')],
          { add: function () { return { label: 'Démo', url: 'https://' }; }, title: function (i) { return i.label + ' — ' + i.url; }, open: true, max: 4 }),
        T('muted', 'Mention en bas à gauche (ex. « Code privé »)'), T('kind', 'Mention en bas à droite (ex. « Système »)')
      ], { add: function () {
        var first = state.content.projects.categories[0];
        return { category: first ? first.id : '', chip: first ? first.label : '', title: 'Nouveau projet', sub: '', description: '', tags: [], image: { src: '', alt: '' }, links: [], muted: '', kind: '' };
      }, title: function (i) { return i.title; }, max: 60 })
    ] },

    { id: 'about', label: 'À propos', root: function (c) { return c.about; }, fields: [
      HEAD(false),
      A('lead', 'Paragraphe d\'introduction', { rows: 4, hint: NBSP }),
      A('body', 'Second paragraphe', { rows: 5, hint: NBSP }),
      LIST('skills', 'Compétences', [T('label', 'Catégorie'), A('value', 'Contenu', { rows: 2 })],
        { add: function () { return { label: 'Nouvelle catégorie', value: '' }; }, title: function (i) { return i.label; }, max: 10 }),
      G('card', 'Carte d\'identité', [
        T('mark', 'Monogramme', { short: true }), T('name', 'Nom'), T('role', 'Métier'), T('where', 'Lieu'), T('state', 'Statut')
      ]),
      LIST('stats', 'Chiffres clés', [
        T('num', 'Valeur'), T('label', 'Légende'),
        B('auto', 'Valeur automatique = nombre de dépôts GitHub (section GitHub)')
      ], { add: function () { return { num: '0', label: 'Nouveau', auto: false }; }, title: function (i) { return i.num + ' ' + i.label; }, max: 8 })
    ] },

    { id: 'timeline', label: 'Parcours', root: function (c) { return c.timeline; }, fields: [
      HEAD(false),
      LIST('items', 'Étapes (de la plus récente à la plus ancienne)', [
        T('year', 'Période'), T('title', 'Titre'), A('description', 'Description', { rows: 4, hint: NBSP }), L('tags', 'Technologies')
      ], { add: function () { return { year: String(new Date().getFullYear()), title: 'Nouvelle étape', description: '', tags: [] }; },
        title: function (i) { return i.year + ' — ' + i.title; }, max: 30 })
    ] },

    { id: 'github', label: 'GitHub', root: function (c) { return c.github; }, fields: [
      HEAD(true),
      T('user', 'Compte GitHub', { short: true, hint: 'Sans le @.' }),
      T('buttonLabel', 'Texte du bouton'), U('buttonUrl', 'Lien du bouton (laisser vide pour masquer)'),
      { type: 'custom', render: githubSync },
      G('stats', 'Chiffres affichés', [
        { type: 'number', k: 'count', label: 'Dépôts publics' }, { type: 'number', k: 'languages', label: 'Langages' }, T('since', 'Compte depuis')
      ]),
      LIST('repos', 'Dépôts affichés', [
        T('name', 'Nom'), U('url', 'Adresse du dépôt'), T('language', 'Langage'),
        T('color', 'Couleur du langage (facultatif, #rrggbb)', { mono: true, short: true }),
        T('description', 'Description'), T('updated', 'Dernière mise à jour (ex. « mars 2026 »)'), U('homepage', 'Site en ligne (facultatif)')
      ], { add: function () { return { name: 'nouveau-depot', url: 'https://github.com/', language: '', color: '', description: '', updated: '', homepage: '' }; },
        title: function (i) { return i.name; }, max: 100 }),
      T('note', 'Note sous la liste', { hint: 'Laissez vide pour la masquer. {code|texte} pour du code. ' + NBSP })
    ] },

    { id: 'contact', label: 'Contact & pied de page', root: function (c) { return c; }, fields: [
      G('contact', 'Section contact', [
        G('head', 'Titre', [T('num', 'Numéro', { short: true }), T('eyebrow', 'Étiquette')]),
        A('title', 'Grand titre', { hint: MARK + ' ' + NBSP }),
        A('lede', 'Texte d\'introduction', { hint: NBSP }),
        T('email', 'Adresse e-mail', { hint: 'Laisser vide pour masquer les boutons e-mail.' }),
        T('copyLabel', 'Texte du bouton « copier »'), T('cvLabel', 'Texte du bouton CV'),
        T('githubLabel', 'Texte du lien GitHub'), U('githubUrl', 'Adresse GitHub (vide = masqué)'), T('location', 'Localisation (vide = masquée)')
      ]),
      G('footer', 'Pied de page', [
        T('mark', 'Monogramme', { short: true }), T('name', 'Nom'),
        T('note', 'Texte avant l\'année', { hint: 'L\'année courante est ajoutée automatiquement.' }), T('topLabel', 'Texte « retour en haut »')
      ])
    ] },

    { id: 'media', label: 'Médias', custom: mediaTab },
    { id: 'backups', label: 'Sauvegardes', custom: backupsTab },
    { id: 'account', label: 'Compte', custom: accountTab }
  ];

  /* ============================================================
     Moteur de formulaires
     ============================================================ */
  function fieldWrap(f, input, extra) {
    var id = 'f' + Math.random().toString(36).slice(2, 9);
    input.id = id;
    return h('div', { class: 'field' + (f.short ? ' field--short' : '') },
      h('label', { for: id }, f.label), input, f.hint ? h('p', { class: 'hint' }, f.hint) : null, extra);
  }

  function renderField(obj, f, ctx) {
    var k = f.k;
    var onEdit = function () { touch(); if (f.rerender) ctx.rerender(); };
    switch (f.type) {
      case 'text': {
        var input = h('input', { type: 'text', value: obj[k] || '', placeholder: f.placeholder, class: f.mono ? 'mono' : '', autocomplete: 'off', spellcheck: f.mono ? 'false' : 'true' });
        input.addEventListener('input', function () { obj[k] = input.value; onEdit(); });
        input.addEventListener('focus', function () { state.lastField = input; });
        return fieldWrap(f, input);
      }
      case 'number': {
        var num = h('input', { type: 'number', min: 0, value: String(obj[k] || 0) });
        num.addEventListener('input', function () { obj[k] = Number(num.value) || 0; touch(); });
        return fieldWrap(f, num);
      }
      case 'area': {
        var ta = h('textarea', { rows: f.rows || 3, value: obj[k] || '' });
        ta.addEventListener('input', function () { obj[k] = ta.value; onEdit(); });
        ta.addEventListener('focus', function () { state.lastField = ta; });
        return fieldWrap(f, ta);
      }
      case 'lines': {
        var tl = h('textarea', { rows: f.rows || Math.max(3, Math.min(10, (obj[k] || []).length + 1)), value: (obj[k] || []).join('\n') });
        tl.addEventListener('input', function () {
          obj[k] = tl.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
          touch();
        });
        tl.addEventListener('focus', function () { state.lastField = tl; });
        return fieldWrap(f, tl);
      }
      case 'bool': {
        var cb = h('input', { type: 'checkbox', checked: Boolean(obj[k]) });
        cb.addEventListener('change', function () { obj[k] = cb.checked; onEdit(); });
        return h('div', { class: 'field field--check' }, h('label', null, cb, ' ', f.label));
      }
      case 'select': {
        var sel = h('select');
        var fill = function () {
          var opts = typeof f.options === 'function' ? f.options() : f.options;
          var current = obj[k];
          sel.replaceChildren();
          opts.forEach(function (o) { sel.append(h('option', { value: o[0] }, o[1])); });
          if (current && !opts.some(function (o) { return o[0] === current; })) sel.append(h('option', { value: current }, current + ' (inconnu)'));
          sel.value = current;
        };
        fill();
        sel.addEventListener('focus', fill);
        sel.addEventListener('pointerdown', fill);
        sel.addEventListener('change', function () { obj[k] = sel.value; onEdit(); });
        return fieldWrap(f, sel);
      }
      case 'path': return pathField(obj, f);
      case 'image': return imageField(obj, f);
      case 'group': {
        var target = f.k ? obj[f.k] : obj;
        var box = h('fieldset', { class: 'group' }, h('legend', null, f.title));
        renderFields(box, target, f.fields, ctx);
        return box;
      }
      case 'list': return listField(obj, f, ctx);
      case 'custom': return f.render(obj, ctx);
      default: return h('p', null, 'Champ inconnu');
    }
  }

  function renderFields(parent, obj, fields, ctx) {
    fields.forEach(function (f) {
      if (f.show && !f.show(obj)) return;
      parent.append(renderField(obj, f, ctx));
    });
  }

  function listField(obj, f, ctx) {
    var arr = obj[f.k];
    var wrap = h('div', { class: 'list' });
    var openLast = false;

    function draw() {
      wrap.replaceChildren(h('div', { class: 'list__head' }, h('h4', null, f.label), h('span', { class: 'count' }, String(arr.length))));
      arr.forEach(function (item, i) {
        var titleEl = h('span', { class: 'item__title' }, f.title(item) || '(sans titre)');
        var move = function (d) {
          return function (e) {
            e.preventDefault(); e.stopPropagation();
            var j = i + d;
            if (j < 0 || j >= arr.length) return;
            var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
            touch(); draw();
          };
        };
        var tools = h('span', { class: 'item__tools' },
          h('button', { type: 'button', class: 'icon', title: 'Monter', 'aria-label': 'Monter', disabled: i === 0, onclick: move(-1) }, '↑'),
          h('button', { type: 'button', class: 'icon', title: 'Descendre', 'aria-label': 'Descendre', disabled: i === arr.length - 1, onclick: move(1) }, '↓'),
          h('button', { type: 'button', class: 'icon', title: 'Dupliquer', 'aria-label': 'Dupliquer', onclick: function (e) {
            e.preventDefault(); e.stopPropagation();
            if (f.max && arr.length >= f.max) return toast('Maximum atteint (' + f.max + ').', 'warn');
            arr.splice(i + 1, 0, JSON.parse(JSON.stringify(item))); touch(); draw();
          } }, '⧉'),
          h('button', { type: 'button', class: 'icon icon--danger', title: 'Supprimer', 'aria-label': 'Supprimer', onclick: function (e) {
            e.preventDefault(); e.stopPropagation();
            if (!confirm('Supprimer « ' + (f.title(item) || 'cet élément') + ' » ?')) return;
            arr.splice(i, 1); touch(); draw();
          } }, '✕'));
        var body = h('div', { class: 'item__body' });
        var drawBody = function () { body.replaceChildren(); renderFields(body, item, f.item, { rerender: drawBody }); };
        drawBody();
        var det = h('details', { class: 'item' }, h('summary', null, h('span', { class: 'item__n' }, String(i + 1)), titleEl, tools), body);
        if (f.open || (openLast && i === arr.length - 1)) det.open = true;
        det.addEventListener('input', function () { titleEl.textContent = f.title(item) || '(sans titre)'; });
        wrap.append(det);
      });
      openLast = false;
      wrap.append(h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: function () {
        if (f.max && arr.length >= f.max) return toast('Maximum atteint (' + f.max + ').', 'warn');
        arr.push(f.add()); openLast = true; touch(); draw();
        var last = wrap.querySelector('details:last-of-type input, details:last-of-type textarea');
        if (last) last.focus();
      } }, '+ Ajouter'));
    }
    draw();
    return wrap;
  }

  /* ---------- Champs fichier ---------- */
  function pathField(obj, f) {
    var box = h('div', { class: 'field' });
    var draw = function () {
      var value = obj[f.k];
      box.replaceChildren(h('label', null, f.label), h('div', { class: 'picker' },
        value && f.kind === 'image' ? h('img', { class: 'thumb', src: '/' + value, alt: '' }) : null,
        h('span', { class: 'picker__name mono' }, value || 'Aucun fichier'),
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: function () {
          pickMedia(f.kind).then(function (p) { if (p) { obj[f.k] = p; touch(); draw(); } });
        } }, 'Choisir…'),
        value ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: function () { obj[f.k] = ''; touch(); draw(); } }, 'Retirer') : null));
    };
    draw();
    return box;
  }

  function imageField(obj, f) {
    var im = obj[f.k] || (obj[f.k] = { src: '', alt: '' });
    var box = h('div', { class: 'field field--image' });
    var draw = function () {
      var alt = h('input', { type: 'text', value: im.alt || '', placeholder: 'Décrivez l\'image (accessibilité et référencement)' });
      alt.addEventListener('input', function () { im.alt = alt.value; touch(); });
      alt.addEventListener('focus', function () { state.lastField = alt; });
      box.replaceChildren(h('label', null, f.label), h('div', { class: 'picker' },
        im.src ? h('img', { class: 'thumb', src: '/' + im.src, alt: '' }) : h('span', { class: 'thumb thumb--empty' }, '∅'),
        h('span', { class: 'picker__name mono' }, im.src || 'Aucune image'),
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: function () {
          pickMedia('image').then(function (p) { if (p) { im.src = p; touch(); draw(); } });
        } }, 'Choisir…'),
        im.src ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: function () { im.src = ''; touch(); draw(); } }, 'Retirer') : null),
      h('label', { class: 'sub' }, 'Texte alternatif'), alt);
    };
    draw();
    return box;
  }

  /* ============================================================
     Médiathèque
     ============================================================ */
  function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' Mo' : Math.max(1, Math.round(n / 1024)) + ' Ko'; }

  function uploadFile(file, kind) {
    var max = kind === 'doc' ? 12 * 1048576 : 8 * 1048576;
    if (file.size > max) return Promise.reject(new Error('Fichier trop volumineux (max ' + fmtSize(max) + ').'));
    return file.arrayBuffer().then(function (buf) {
      return api('POST', '/api/media?kind=' + kind + '&name=' + encodeURIComponent(file.name), undefined, buf);
    });
  }

  function mediaGrid(opts) {
    var wrap = h('div', { class: 'media' });
    var grid = h('div', { class: 'media__grid' });
    var kind = opts.kind;
    var fileInput = h('input', { type: 'file', class: 'sr-only', accept: kind === 'doc' ? 'application/pdf' : 'image/jpeg,image/png,image/webp,image/gif', multiple: true });
    var status = h('p', { class: 'hint' }, kind === 'doc' ? 'PDF, 12 Mo maximum.' : 'JPEG, PNG, WebP ou GIF — 8 Mo maximum. Glissez-déposez ou utilisez le bouton.');

    function load() {
      api('GET', '/api/media').then(function (data) {
        grid.replaceChildren();
        var items = data.media.filter(function (m) { return kind === 'doc' ? m.type === 'pdf' : (m.type !== 'pdf'); });
        if (!items.length) grid.append(h('p', { class: 'muted' }, 'Aucun fichier.'));
        items.forEach(function (m) {
          var preview = kind === 'doc' ? h('div', { class: 'media__doc' }, 'PDF') : h('img', { src: '/' + m.path, alt: '', loading: 'lazy' });
          var actions = h('div', { class: 'media__actions' });
          if (opts.onPick) actions.append(h('button', { type: 'button', class: 'btn btn--primary btn--sm', onclick: function () { opts.onPick(m.path); } }, 'Utiliser'));
          if (opts.manage) {
            actions.append(h('a', { class: 'btn btn--ghost btn--sm', href: '/' + m.path, target: '_blank', rel: 'noopener' }, 'Ouvrir'));
            actions.append(h('button', { type: 'button', class: 'btn btn--ghost btn--sm btn--danger', disabled: m.used, title: m.used ? 'Utilisé sur le site' : 'Supprimer', onclick: function () {
              if (!confirm('Supprimer définitivement « ' + m.name + ' » ?')) return;
              api('POST', '/api/media/delete', { path: m.path }).then(function () { toast('Fichier supprimé.'); load(); }).catch(function (e) { toast(e.message, 'error'); });
            } }, 'Supprimer'));
          }
          grid.append(h('figure', { class: 'media__item' + (m.used ? ' is-used' : '') }, preview,
            h('figcaption', null, h('strong', { class: 'mono' }, m.name),
              h('span', { class: 'muted' }, fmtSize(m.size) + (m.width ? ' · ' + m.width + '×' + m.height : '') + (m.used ? ' · utilisé' : ''))),
            actions));
        });
      }).catch(function (e) { grid.replaceChildren(h('p', { class: 'error' }, e.message)); });
    }

    function handle(files) {
      var list = Array.prototype.slice.call(files);
      if (!list.length) return;
      status.textContent = 'Envoi en cours…';
      list.reduce(function (p, file) {
        return p.then(function () { return uploadFile(file, kind); }).then(function (r) { if (opts.onUploaded) opts.onUploaded(r.path); });
      }, Promise.resolve()).then(function () { status.textContent = 'Envoi terminé.'; load(); })
        .catch(function (e) { status.textContent = ''; toast(e.message, 'error', true); load(); });
    }

    fileInput.addEventListener('change', function () { handle(fileInput.files); fileInput.value = ''; });
    wrap.addEventListener('dragover', function (e) { e.preventDefault(); wrap.classList.add('is-drop'); });
    wrap.addEventListener('dragleave', function () { wrap.classList.remove('is-drop'); });
    wrap.addEventListener('drop', function (e) { e.preventDefault(); wrap.classList.remove('is-drop'); handle(e.dataTransfer.files); });

    wrap.append(h('div', { class: 'media__bar' },
      h('button', { type: 'button', class: 'btn btn--primary btn--sm', onclick: function () { fileInput.click(); } }, kind === 'doc' ? 'Envoyer un PDF' : 'Envoyer des images'),
      status), fileInput, grid);
    load();
    return wrap;
  }

  function pickMedia(kind) {
    return new Promise(function (resolve) {
      var done = function (v) { dlg.close(); dlg.remove(); resolve(v); };
      var dlg = h('dialog', { class: 'modal' },
        h('div', { class: 'modal__head' }, h('h3', null, kind === 'doc' ? 'Choisir un document' : 'Choisir une image'),
          h('button', { type: 'button', class: 'icon', 'aria-label': 'Fermer', onclick: function () { done(null); } }, '✕')),
        mediaGrid({ kind: kind, onPick: done }));
      dlg.addEventListener('cancel', function () { dlg.remove(); resolve(null); });
      document.body.append(dlg);
      dlg.showModal();
    });
  }

  function mediaTab(panel) {
    panel.append(h('h2', null, 'Médias'),
      h('p', { class: 'muted' }, 'Envoyez les images et le CV utilisés par le site. Un fichier encore utilisé ne peut pas être supprimé. Les formats SVG ne sont pas acceptés à l\'envoi (sécurité).'),
      h('h3', null, 'Images'), mediaGrid({ kind: 'image', manage: true }),
      h('h3', null, 'Documents (CV)'), mediaGrid({ kind: 'doc', manage: true }));
  }

  /* ============================================================
     GitHub, sauvegardes, compte
     ============================================================ */
  function githubSync(gh, ctx) {
    var forks = h('input', { type: 'checkbox' });
    var archived = h('input', { type: 'checkbox' });
    var btn = h('button', { type: 'button', class: 'btn btn--ghost', onclick: function () {
      if (!confirm('Remplacer la liste des dépôts ci-dessous par celle de GitHub ? (Vous pourrez annuler en ne sauvegardant pas.)')) return;
      btn.disabled = true; btn.textContent = 'Synchronisation…';
      api('POST', '/api/github/sync', { user: gh.user, forks: forks.checked, archived: archived.checked }).then(function (data) {
        gh.repos = data.repos; gh.stats = data.stats; touch(); ctx.refreshTab();
        toast(data.repos.length + ' dépôt(s) importé(s). Pensez à enregistrer.', 'ok', true);
      }).catch(function (e) { toast(e.message, 'error', true); btn.disabled = false; btn.textContent = 'Synchroniser depuis GitHub'; });
    } }, 'Synchroniser depuis GitHub');
    return h('div', { class: 'group sync' }, h('p', null, 'Récupère automatiquement vos dépôts publics (nom, description, langage, dernière mise à jour).'),
      h('label', { class: 'inline' }, forks, ' inclure les forks'), h('label', { class: 'inline' }, archived, ' inclure les archivés'), btn);
  }

  function backupsTab(panel) {
    panel.append(h('h2', null, 'Sauvegardes'),
      h('p', { class: 'muted' }, 'Une copie est créée automatiquement à chaque enregistrement (les 60 dernières sont conservées). Restaurer remplace le contenu actuel — qui est lui-même sauvegardé avant.'));
    var list = h('div', { class: 'backups' }, h('p', { class: 'muted' }, 'Chargement…'));
    panel.append(list);
    api('GET', '/api/backups').then(function (data) {
      list.replaceChildren();
      if (!data.backups.length) list.append(h('p', { class: 'muted' }, 'Aucune sauvegarde pour l\'instant.'));
      data.backups.forEach(function (b) {
        list.append(h('div', { class: 'backup' },
          h('span', null, new Date(b.createdAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'medium' })),
          h('span', { class: 'muted' }, fmtSize(b.size)),
          h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: function () {
            if (state.dirty && !confirm('Des modifications non enregistrées seront perdues. Continuer ?')) return;
            if (!confirm('Restaurer cette version ? Le site sera mis à jour immédiatement.')) return;
            api('POST', '/api/backups/restore', { id: b.id }).then(function (r) {
              state.content = r.content; state.rev = r.rev; state.dirty = false;
              toast('Version restaurée et publiée.', 'ok'); render();
            }).catch(function (e) { toast(e.message, 'error'); });
          } }, 'Restaurer')));
      });
    }).catch(function (e) { list.replaceChildren(h('p', { class: 'error' }, e.message)); });
  }

  function accountTab(panel) {
    var cur = h('input', { type: 'password', autocomplete: 'current-password', id: 'pw-cur' });
    var nw = h('input', { type: 'password', autocomplete: 'new-password', id: 'pw-new' });
    var again = h('input', { type: 'password', autocomplete: 'new-password', id: 'pw-again' });
    var msg = h('p', { class: 'error', role: 'alert' });
    panel.append(h('h2', null, 'Compte'),
      h('form', { class: 'group', onsubmit: function (e) {
        e.preventDefault(); msg.textContent = ''; msg.className = 'error';
        if (nw.value !== again.value) { msg.textContent = 'Les deux nouveaux mots de passe sont différents.'; return; }
        api('POST', '/api/password', { current: cur.value, next: nw.value }).then(function () {
          cur.value = nw.value = again.value = '';
          msg.className = 'ok'; msg.textContent = 'Mot de passe modifié. Les autres sessions ont été déconnectées.';
        }).catch(function (err) { msg.textContent = err.message; });
      } },
      h('h3', null, 'Changer le mot de passe'),
      h('div', { class: 'field' }, h('label', { for: 'pw-cur' }, 'Mot de passe actuel'), cur),
      h('div', { class: 'field' }, h('label', { for: 'pw-new' }, 'Nouveau mot de passe (10 caractères minimum)'), nw),
      h('div', { class: 'field' }, h('label', { for: 'pw-again' }, 'Confirmer'), again),
      h('button', { class: 'btn btn--primary', type: 'submit' }, 'Modifier'), msg));
  }

  /* ============================================================
     Coque de l'application
     ============================================================ */
  function save() {
    var btn = document.getElementById('save');
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }
    return api('PUT', '/api/content', { content: state.content, rev: state.rev }).then(function (r) {
      state.content = r.content; state.rev = r.rev; state.dirty = false;
      if (r.warnings && r.warnings.length) {
        toast(h('div', null, h('strong', null, 'Enregistré, avec des corrections :'), h('ul', null, r.warnings.slice(0, 8).map(function (w) { return h('li', null, w); }))), 'warn', true);
      } else toast('Enregistré — le site est à jour.', 'ok');
      render();
    }).catch(function (e) {
      toast(e.message, 'error', true);
      if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer et publier'; }
    });
  }

  function preview() {
    api('POST', '/api/preview', { content: state.content }).then(function () {
      var frame = h('iframe', { class: 'preview__frame', src: '/admin/preview?t=' + Date.now(), title: 'Aperçu du site' });
      var dlg = h('dialog', { class: 'preview' },
        h('div', { class: 'preview__bar' },
          h('strong', null, 'Aperçu (non enregistré)'),
          h('span', { class: 'preview__sizes' },
            ['Ordinateur', 'Tablette', 'Mobile'].map(function (label, i) {
              var w = [null, '820px', '390px'][i];
              return h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: function () { frame.style.maxWidth = w || 'none'; } }, label);
            })),
          h('button', { type: 'button', class: 'btn btn--primary btn--sm', onclick: function () { dlg.close(); dlg.remove(); } }, 'Fermer')),
        frame);
      dlg.addEventListener('cancel', function () { dlg.remove(); });
      document.body.append(dlg);
      dlg.showModal();
    }).catch(function (e) { toast(e.message, 'error'); });
  }

  function insertNbsp() {
    var el = state.lastField;
    if (!el || !document.body.contains(el)) return toast('Cliquez d\'abord dans un champ de texte.', 'warn');
    var s = el.selectionStart, e = el.selectionEnd;
    el.setRangeText(' ', s, e, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
  }

  function render() {
    var scroll = window.scrollY;
    var tab = TABS.filter(function (t) { return t.id === state.tab; })[0] || TABS[0];
    var panel = h('section', { class: 'panel', id: 'panel', 'aria-label': tab.label });

    var ctx = { rerender: function () {}, refreshTab: function () { render(); } };
    if (tab.custom) tab.custom(panel);
    else {
      panel.append(h('h2', null, tab.label));
      renderFields(panel, tab.root(state.content), tab.fields, ctx);
    }

    var nav = h('nav', { class: 'tabs', 'aria-label': 'Sections' }, TABS.map(function (t) {
      return h('button', { type: 'button', class: 'tab' + (t.id === state.tab ? ' is-active' : ''), 'aria-current': t.id === state.tab ? 'page' : null, onclick: function () {
        state.tab = t.id; state.lastField = null; render(); window.scrollTo(0, 0);
      } }, t.label);
    }));

    var bar = h('header', { class: 'topbar' },
      h('strong', { class: 'topbar__title' }, 'Administration'),
      h('span', { id: 'status', class: 'status' + (state.dirty ? ' is-dirty' : ''), role: 'status' }, state.dirty ? 'Modifications non enregistrées' : 'Tout est enregistré'),
      h('span', { class: 'topbar__actions' },
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', title: 'Insère une espace insécable dans le dernier champ utilisé', onclick: insertNbsp }, 'Espace insécable'),
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: preview }, 'Aperçu'),
        h('a', { class: 'btn btn--ghost btn--sm', href: '/', target: '_blank', rel: 'noopener' }, 'Voir le site'),
        h('button', { id: 'save', type: 'button', class: 'btn btn--primary btn--sm', onclick: save }, 'Enregistrer et publier'),
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: function () {
          if (state.dirty && !confirm('Des modifications non enregistrées seront perdues. Se déconnecter ?')) return;
          state.dirty = false;
          api('POST', '/api/logout').then(function () { state.content = null; showLogin(); });
        } }, 'Déconnexion')));

    app.replaceChildren(bar, h('div', { class: 'layout' }, nav, panel));
    window.scrollTo(0, scroll);
  }

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && state.content) { e.preventDefault(); save(); }
  });

  function boot() {
    api('GET', '/api/session').then(function (s) {
      if (!s.configured) return showNotConfigured();
      if (!s.authenticated) return showLogin();
      return api('GET', '/api/content').then(function (data) {
        state.content = data.content; state.rev = data.rev; state.dirty = false;
        render();
      });
    }).catch(function (e) { app.replaceChildren(h('main', { class: 'center' }, h('p', { class: 'error' }, e.message))); });
  }

  boot();
})();
