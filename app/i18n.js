/**
 * i18n.js — client-side internationalisation
 *
 * 1. Fetches /api/lang  → { lang: "en" | "fr" }
 * 2. Fetches /i18n/<lang>.json  → translation dictionary
 * 3. Applies translations to elements with:
 *    - data-i18n="key"          → sets textContent
 *    - data-i18n-html="key"     → sets innerHTML
 *    - data-i18n-placeholder="key" → sets placeholder attribute
 *    - data-i18n-title="key"    → sets title attribute
 *    - data-i18n-aria="key"     → sets aria-label attribute
 * 4. Exposes window.t(key) for inline script usage
 * 5. Sets window._lang
 * 6. Dispatches "i18nLoaded" on document when done
 */
(async function () {
  let dict = {};

  function t(key) {
    return dict[key] !== undefined ? dict[key] : key;
  }

  window.t = t;

  function applyTranslations() {
    // data-i18n → textContent
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (key && dict[key] !== undefined) el.textContent = dict[key];
    });

    // data-i18n-html → innerHTML
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      const key = el.getAttribute('data-i18n-html');
      if (key && dict[key] !== undefined) el.innerHTML = dict[key];
    });

    // data-i18n-placeholder → placeholder attribute
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key && dict[key] !== undefined) el.setAttribute('placeholder', dict[key]);
    });

    // data-i18n-title → title attribute
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      if (key && dict[key] !== undefined) el.setAttribute('title', dict[key]);
    });

    // data-i18n-aria → aria-label attribute
    document.querySelectorAll('[data-i18n-aria]').forEach(el => {
      const key = el.getAttribute('data-i18n-aria');
      if (key && dict[key] !== undefined) el.setAttribute('aria-label', dict[key]);
    });
  }

  try {
    const langRes = await fetch('/api/lang');
    const { lang } = await langRes.json();
    window._lang = lang || 'en';

    const dictRes = await fetch('/i18n/' + window._lang + '.json');
    dict = await dictRes.json();

    // Re-expose t with loaded dict
    window.t = t;
  } catch (e) {
    // Fallback: keep empty dict, page shows original French fallback text
    window._lang = window._lang || 'en';
    window.t = t;
  }

  // Apply as soon as DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      applyTranslations();
      document.dispatchEvent(new Event('i18nLoaded'));
    });
  } else {
    applyTranslations();
    document.dispatchEvent(new Event('i18nLoaded'));
  }
})();
