/*
 * Mon tapis tout frais — theme.js
 * JavaScript vanilla, zéro dépendance. Chaque module est autonome et ne
 * s'exécute que si les éléments concernés sont présents dans le DOM.
 */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var routes = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
  var money = (window.MTF && window.MTF.moneyFormat) || '{{amount}} €';

  /* ---------------------------------------------------------------- utils */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function formatMoney(cents) {
    var value = (cents / 100).toFixed(2).replace('.', ',');
    return money.replace('{{amount}}', value).replace('{{ amount }}', value);
  }

  function focusableIn(container) {
    return $all('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])', container)
      .filter(function (el) { return el.offsetParent !== null || el === document.activeElement; });
  }

  function trapFocus(container, event) {
    var focusables = focusableIn(container);
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      last.focus(); event.preventDefault();
    } else if (!event.shiftKey && document.activeElement === last) {
      first.focus(); event.preventDefault();
    }
  }

  /* -------------------------------------------------------- reveal on scroll */
  function initReveal() {
    var els = $all('.reveal');
    if (!els.length) return;
    if (reduceMotion || !('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          obs.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    els.forEach(function (el) { obs.observe(el); });
  }

  /* ------------------------------------------------------------ header menu */
  function initHeaderMenu() {
    var toggle = $('[data-menu-toggle]');
    var menu = $('[data-menu]');
    if (!toggle || !menu) return;
    function setOpen(open) {
      toggle.setAttribute('aria-expanded', String(open));
      menu.classList.toggle('is-open', open);
      document.body.classList.toggle('menu-open', open);
    }
    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });
    menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setOpen(false);
    });
  }

  /* ------------------------------------------------------- header on scroll */
  function initHeaderScroll() {
    var header = $('[data-header]');
    if (!header) return;
    var last = 0;
    window.addEventListener('scroll', function () {
      var y = window.pageYOffset;
      header.classList.toggle('is-scrolled', y > 12);
      last = y;
    }, { passive: true });
  }

  /* -------------------------------------------------------------- cart drawer */
  var CartDrawer = (function () {
    var lastFocus = null;

    function drawer() { return $('[data-cart-drawer]'); }

    function open() {
      var d = drawer();
      if (!d) return;
      lastFocus = document.activeElement;
      d.classList.add('is-open');
      d.setAttribute('aria-hidden', 'false');
      document.body.classList.add('drawer-open');
      var focusTarget = $('[data-cart-close]', d) || d;
      window.setTimeout(function () { focusTarget.focus(); }, 60);
      document.addEventListener('keydown', onKey);
    }

    function close() {
      var d = drawer();
      if (!d) return;
      d.classList.remove('is-open');
      d.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('drawer-open');
      document.removeEventListener('keydown', onKey);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    function onKey(e) {
      var d = drawer();
      if (!d) return;
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') trapFocus(d, e);
    }

    function refresh(sections) {
      if (!sections || !sections['cart-drawer']) return;
      var parsed = new DOMParser().parseFromString(sections['cart-drawer'], 'text/html');
      var next = parsed.querySelector('[data-cart-inner]');
      var current = $('[data-cart-inner]');
      if (next && current) current.replaceWith(next);
      // Mirror the fresh item count to the header bubble.
      var source = parsed.querySelector('[data-cart-count]');
      var count = source ? source.getAttribute('data-cart-count') : null;
      $all('[data-cart-bubble]').forEach(function (b) {
        if (count === null) return;
        b.setAttribute('data-count', count);
        b.classList.toggle('is-empty', count === '0');
        var label = $('[data-cart-bubble-count]', b);
        if (label) label.textContent = count;
      });
    }

    return { open: open, close: close, refresh: refresh, el: drawer };
  })();

  function initCart() {
    // Toggle / close via delegation.
    document.addEventListener('click', function (e) {
      var toggle = e.target.closest('[data-cart-toggle]');
      if (toggle) {
        if (CartDrawer.el()) { e.preventDefault(); CartDrawer.open(); }
        return; // otherwise let the link fall through to /cart
      }
      if (e.target.closest('[data-cart-close]') || e.target.closest('[data-cart-overlay]')) {
        e.preventDefault(); CartDrawer.close();
      }
    });

    // Add to cart.
    $all('form[data-product-form]').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var button = form.querySelector('[type="submit"]');
        var body = new FormData(form);
        body.append('sections', 'cart-drawer');
        body.append('sections_url', window.location.pathname);
        if (button) { button.classList.add('is-loading'); button.setAttribute('aria-busy', 'true'); }
        fetch(routes + 'cart/add.js', {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: body
        })
          .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
          .then(function (res) {
            if (!res.ok) { flashFormError(form, res.data && res.data.description); return; }
            CartDrawer.refresh(res.data.sections);
            CartDrawer.open();
          })
          .catch(function () { flashFormError(form); })
          .then(function () {
            if (button) { button.classList.remove('is-loading'); button.removeAttribute('aria-busy'); }
          });
      });
    });

    // Quantity change / remove inside the drawer (delegated).
    document.addEventListener('click', function (e) {
      var change = e.target.closest('[data-line-change]');
      if (!change) return;
      e.preventDefault();
      var line = change.getAttribute('data-line');
      var qty = parseInt(change.getAttribute('data-line-change'), 10);
      changeLine(line, qty);
    });
  }

  function changeLine(line, quantity) {
    var d = CartDrawer.el();
    if (d) d.classList.add('is-busy');
    fetch(routes + 'cart/change.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ line: parseInt(line, 10), quantity: quantity, sections: 'cart-drawer', sections_url: window.location.pathname })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) { CartDrawer.refresh(data.sections); })
      .catch(function () {})
      .then(function () { if (d) d.classList.remove('is-busy'); });
  }

  function flashFormError(form, message) {
    var box = form.querySelector('[data-form-error]');
    if (!box) return;
    box.textContent = message || 'Oups, un souci. Réessaie dans un instant.';
    box.hidden = false;
  }

  /* -------------------------------------------------------- quantity steppers */
  function initQuantitySteppers() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-qty-step]');
      if (!btn) return;
      var wrap = btn.closest('[data-qty]');
      var input = wrap && wrap.querySelector('input');
      if (!input) return;
      var step = parseInt(btn.getAttribute('data-qty-step'), 10);
      var min = parseInt(input.getAttribute('min') || '1', 10);
      var val = parseInt(input.value || '1', 10) + step;
      if (val < min) val = min;
      input.value = val;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  /* ------------------------------------------------------------- modal (a11y) */
  function initModals() {
    var lastFocus = null;
    function openModal(id) {
      var modal = document.getElementById(id);
      if (!modal) return;
      lastFocus = document.activeElement;
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('drawer-open');
      var target = modal.querySelector('[data-modal-close]') || modal;
      window.setTimeout(function () { target.focus(); }, 60);
      modal._onKey = function (e) {
        if (e.key === 'Escape') closeModal(modal);
        if (e.key === 'Tab') trapFocus(modal, e);
      };
      document.addEventListener('keydown', modal._onKey);
    }
    function closeModal(modal) {
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('drawer-open');
      if (modal._onKey) document.removeEventListener('keydown', modal._onKey);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    document.addEventListener('click', function (e) {
      var opener = e.target.closest('[data-modal-open]');
      if (opener) { e.preventDefault(); openModal(opener.getAttribute('data-modal-open')); return; }
      var closer = e.target.closest('[data-modal-close]');
      if (closer) { e.preventDefault(); closeModal(closer.closest('[data-modal]')); }
    });
  }

  /* ------------------------------------------------------- product: variants */
  function initVariantPicker() {
    var root = $('[data-product-root]');
    if (!root) return;
    var dataEl = $('[data-variants-json]', root);
    if (!dataEl) return;
    var variants;
    try { variants = JSON.parse(dataEl.textContent); } catch (err) { return; }

    function currentSelection() {
      var opts = [];
      $all('[data-option-index]', root).forEach(function (input) {
        if (input.type === 'radio') {
          if (input.checked) opts[parseInt(input.getAttribute('data-option-index'), 10)] = input.value;
        } else {
          opts[parseInt(input.getAttribute('data-option-index'), 10)] = input.value;
        }
      });
      return opts;
    }

    function match(opts) {
      return variants.find(function (v) {
        return v.options.every(function (o, i) { return o === opts[i]; });
      });
    }

    function update() {
      var variant = match(currentSelection());
      var addBtn = $('[data-add-button]', root);
      var priceHost = $('[data-price]', root);
      var idField = $('[data-variant-id]', root);

      if (!variant) {
        if (addBtn) { addBtn.disabled = true; addBtn.setAttribute('data-state', 'unavailable'); }
        return;
      }
      if (idField) idField.value = variant.id;

      // URL (?variant=) without reloading.
      if (history.replaceState) {
        var url = new URL(window.location.href);
        url.searchParams.set('variant', variant.id);
        history.replaceState({}, '', url.toString());
      }

      // Price block re-render.
      if (priceHost) {
        priceHost.innerHTML = renderPrice(variant);
      }

      // Availability + button label.
      if (addBtn) {
        addBtn.disabled = !variant.available;
        addBtn.setAttribute('data-state', variant.available ? 'available' : 'soldout');
        var label = addBtn.querySelector('[data-add-label]');
        if (label) label.textContent = variant.available ? addBtn.getAttribute('data-label-add') : addBtn.getAttribute('data-label-soldout');
      }

      // Sticky ATC price.
      var stickyPrice = $('[data-sticky-price]');
      if (stickyPrice) stickyPrice.textContent = formatMoney(variant.price);

      // Selected media.
      if (variant.featured_media && variant.featured_media.id) {
        var slide = $('[data-media-id="' + variant.featured_media.id + '"]');
        var viewport = $('[data-gallery-viewport]');
        if (slide && viewport) viewport.scrollTo({ left: slide.offsetLeft, behavior: reduceMotion ? 'auto' : 'smooth' });
      }
    }

    function renderPrice(variant) {
      var html = '<span class="price__current">' + formatMoney(variant.price) + '</span>';
      if (variant.compare_at_price && variant.compare_at_price > variant.price) {
        var save = variant.compare_at_price - variant.price;
        html += ' <s class="price__compare">' + formatMoney(variant.compare_at_price) + '</s>';
        html += ' <span class="price__save">' + (priceHostSaveLabel || '−{{amount}}').replace('{{amount}}', formatMoney(save)) + '</span>';
      }
      return html;
    }
    var priceHostSaveLabel = (dataEl.getAttribute('data-save-label') || '−{{amount}}');

    root.addEventListener('change', function (e) {
      if (e.target.closest('[data-option-index]')) update();
    });
    update();
  }

  /* ---------------------------------------------------------- sticky add-to-cart */
  function initStickyAtc() {
    var sticky = $('[data-sticky-atc]');
    var anchor = $('[data-atc-anchor]');
    if (!sticky || !anchor || !('IntersectionObserver' in window)) return;
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        sticky.classList.toggle('is-visible', !entry.isIntersecting && entry.boundingClientRect.top < 0);
      });
    }, { threshold: 0 });
    obs.observe(anchor);
    // Sticky button just forwards to the real product form.
    var stickyBtn = $('[data-sticky-submit]', sticky);
    if (stickyBtn) {
      stickyBtn.addEventListener('click', function () {
        var form = $('form[data-product-form]');
        if (form) form.requestSubmit ? form.requestSubmit() : form.querySelector('[type=submit]').click();
      });
    }
  }

  /* ------------------------------------------------------------- product gallery */
  function initGallery() {
    var viewport = $('[data-gallery-viewport]');
    if (!viewport) return;
    var slides = $all('[data-media-id]', viewport);
    var dots = $all('[data-gallery-dot]');
    if (!slides.length) return;

    function setActive(index) {
      dots.forEach(function (d, i) {
        d.classList.toggle('is-active', i === index);
        d.setAttribute('aria-current', i === index ? 'true' : 'false');
      });
    }
    if ('IntersectionObserver' in window) {
      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            var idx = slides.indexOf(entry.target);
            if (idx > -1) setActive(idx);
          }
        });
      }, { root: viewport, threshold: 0.6 });
      slides.forEach(function (s) { obs.observe(s); });
    }
    dots.forEach(function (dot, i) {
      dot.addEventListener('click', function () {
        if (slides[i]) viewport.scrollTo({ left: slides[i].offsetLeft, behavior: reduceMotion ? 'auto' : 'smooth' });
      });
    });
  }

  /* --------------------------------------------------------- delivery estimate */
  function initDeliveryEstimate() {
    var hosts = $all('[data-delivery-estimate]');
    if (!hosts.length) return;
    var frDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
    function addBusinessDays(start, days) {
      var d = new Date(start);
      var added = 0;
      while (added < days) {
        d.setDate(d.getDate() + 1);
        var wd = d.getDay();
        if (wd !== 0 && wd !== 6) added++;
      }
      return d;
    }
    hosts.forEach(function (host) {
      var min = parseInt(host.getAttribute('data-lead-min') || '2', 10);
      var max = parseInt(host.getAttribute('data-lead-max') || '5', 10);
      var tpl = host.getAttribute('data-template') || '';
      var minDate = frDate.format(addBusinessDays(new Date(), min));
      var maxDate = frDate.format(addBusinessDays(new Date(), max));
      host.innerHTML = tpl.replace('{{ min_date }}', minDate).replace('{{ max_date }}', maxDate)
                          .replace('{{min_date}}', minDate).replace('{{max_date}}', maxDate);
      host.hidden = false;
    });
  }

  /* ---------------------------------------------------------------------- init */
  function init() {
    initReveal();
    initHeaderMenu();
    initHeaderScroll();
    initCart();
    initQuantitySteppers();
    initModals();
    initVariantPicker();
    initStickyAtc();
    initGallery();
    initDeliveryEstimate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
