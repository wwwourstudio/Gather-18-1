// Unified single-slot notification queue for gather studio.
// Replaces competing toasts, layout nudges and setup coaches so only ONE notification shows at a time.
// Supports repeat merging (×N), keyed instant dismissal, and horizontal pointer/touch swipe-to-dismiss.

export function createNotifier(root) {
  const queue = [];
  let active = null; // { key, msg, count, opts, el, timer }
  let hideCoaches = () => {};

  function resolveRoot() {
    if (!root) return null;
    if (typeof root === 'string') return typeof document !== 'undefined' ? document.querySelector(root) : null;
    return typeof root === 'object' && root.nodeType === 1 ? root : null;
  }

  function replaceKids(el, ...nodes) {
    if (!el || typeof el !== 'object') return;
    if (typeof el.replaceChildren === 'function') {
      el.replaceChildren(...nodes);
    } else {
      el.innerHTML = '';
      if (typeof el.append === 'function') el.append(...nodes);
      else for (const n of nodes) if (n != null) el.appendChild(typeof n === 'string' ? document.createTextNode(n) : n);
    }
  }

  function syncPopover(box, open) {
    if (!box) return;
    box.classList.toggle('on', !!open);
    // The bar sits in the page layout. Only while a dialog is open does it float in the top layer, above the dialog.
    if (open && !document.querySelector('dialog[open]')) open = false;
    try {
      if (open && typeof box.showPopover === 'function') {
        if (box.matches?.(':popover-open')) box.hidePopover();
        box.showPopover();
      } else if (!open && typeof box.hidePopover === 'function') {
        if (!box.matches || box.matches(':popover-open')) box.hidePopover();
      }
    } catch {}
  }

  function prefersReducedMotion() {
    try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch { return false; }
  }

  function setCoachVisibility(hasActive) {
    const ss = document.getElementById('sceneSuggest');
    const gd = document.getElementById('guide');
    if (ss) ss.dataset.notifyPaused = hasActive ? '1' : '';
    if (gd) gd.dataset.notifyPaused = hasActive ? '1' : '';
    hideCoaches(hasActive);
  }

  function makeKey(msg, opts) {
    if (opts?.key) return String(opts.key);
    return String(msg || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function renderCount(item) {
    if (!item?.el) return;
    let badge = item.el.querySelector('.toast-count');
    if (item.count > 1) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'toast-count';
        const txt = item.el.querySelector('.toast-txt');
        if (txt && typeof txt.after === 'function') txt.after(badge);
        else if (txt && txt.parentNode) txt.parentNode.insertBefore(badge, txt.nextSibling);
        else item.el.appendChild(badge);
      }
      badge.textContent = `×${item.count}`;
    } else if (badge) {
      badge.remove();
    }
  }

  function finishActive(animate = true) {
    if (!active) return;
    const cur = active;
    active = null;
    clearTimeout(cur.timer);
    const el = cur.el;
    const cleanup = () => {
      if (el && el.parentNode) el.parentNode.removeChild(el);
      const box = resolveRoot();
      if (!active && !queue.length && box && !box.children.length) syncPopover(box, false);
    };
    if (el && el.isConnected) {
      if (animate && !prefersReducedMotion()) {
        el.classList.add('out');
        setTimeout(cleanup, 200);
      } else {
        cleanup();
      }
    } else {
      cleanup();
    }
    if (queue.length) {
      showNext();
    } else {
      setCoachVisibility(false);
    }
  }

  function attachSwipe(el, onDismiss) {
    let startX = 0, dx = 0, dragging = false;
    const onDown = (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      startX = e.clientX;
      dx = 0;
      el.setPointerCapture?.(e.pointerId);
      el.style.transition = 'none';
    };
    const onMove = (e) => {
      if (!dragging) return;
      dx = e.clientX - startX;
      el.style.transform = `translateX(${dx}px)`;
      el.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / 180));
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      el.style.transition = '';
      if (Math.abs(dx) > 72) {
        el.style.transform = `translateX(${dx > 0 ? 220 : -220}px)`;
        el.style.opacity = '0';
        setTimeout(onDismiss, 140);
      } else {
        el.style.transform = '';
        el.style.opacity = '';
      }
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }

  function showNext() {
    if (active || !queue.length) return;
    const box = resolveRoot();
    if (!box) return;
    const item = queue.shift();
    const el = document.createElement('div');
    el.className = 'toast' + (item.opts.err ? ' err' : '') + (item.opts.tone ? ' ' + item.opts.tone : '');
    el.setAttribute('role', item.opts.err ? 'alert' : 'status');
    el.title = 'Swipe to dismiss';
    const txt = document.createElement('span');
    txt.className = 'toast-txt';
    txt.textContent = item.msg;
    el.appendChild(txt);
    if (item.opts.action) {
      const [label, fn] = item.opts.action;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'toast-act';
      b.textContent = label;
      b.onclick = () => {
        try { fn(); } finally { finishActive(true); }
      };
      el.appendChild(b);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-x';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.textContent = '×';
    close.onclick = () => finishActive(true);
    el.appendChild(close);

    item.el = el;
    active = item;
    renderCount(item);
    replaceKids(box, el);
    syncPopover(box, true);
    setCoachVisibility(true);
    attachSwipe(el, () => { if (active === item) finishActive(false); });
    const ms = item.opts.ms ?? (item.opts.err ? 5500 : 3800);
    item.shownAt = Date.now();
    if (ms > 0) {
      item.endsAt = item.shownAt + ms;
      item.timer = setTimeout(() => { if (active === item) finishActive(true); }, ms);
    }
    hurry();
  }

  // While others are waiting, the one on screen steps aside after a short read (errors get longer), so a burst of
  // notifications never delays the answer to what the user just did by many seconds.
  function hurry() {
    const cur = active;
    if (!cur || !queue.length || !cur.endsAt) return;
    const at = cur.shownAt + (cur.opts.err ? 2500 : 1400);
    if (at >= cur.endsAt) return;
    clearTimeout(cur.timer);
    cur.endsAt = at;
    cur.timer = setTimeout(() => { if (active === cur) finishActive(true); }, Math.max(0, at - Date.now()));
  }

  function push(msg, opts = {}) {
    const text = String(msg || '').trim();
    if (!text) return '';
    const key = makeKey(text, opts);
    // Merge with active notification if identical key
    if (active && active.key === key) {
      active.count++;
      active.msg = text;
      const t = active.el?.querySelector('.toast-txt');
      if (t) t.textContent = text;
      renderCount(active);
      clearTimeout(active.timer);
      const ms = opts.ms ?? active.opts.ms ?? 3800;
      if (ms > 0) { active.shownAt = Date.now(); active.endsAt = active.shownAt + ms; active.timer = setTimeout(() => { if (active?.key === key) finishActive(true); }, ms); }
      hurry();
      return key;
    }
    // Merge with queued notification if identical key
    const queued = queue.find((q) => q.key === key);
    if (queued) {
      queued.count++;
      queued.msg = text;
      queued.opts = { ...queued.opts, ...opts };
      return key;
    }
    // Priority errors jump ahead of low-priority nudges
    const entry = { key, msg: text, count: 1, opts, el: null, timer: null };
    if (opts.priority === 'high' || opts.err) queue.unshift(entry);
    else queue.push(entry);
    // Keep queue bounded so bursts never trap the user: drop the oldest ordinary message, never the newest one
    while (queue.length > 6) {
      const i = queue.findIndex((q) => q !== entry && !q.opts.err && q.opts.priority !== 'high');
      queue.splice(i >= 0 ? i : queue.length - 1, 1);
    }
    if (!active) showNext();
    else hurry();
    return key;
  }

  function dismiss(key) {
    if (!key) return;
    if (active && active.key === key) finishActive(true);
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].key === key) queue.splice(i, 1);
    }
  }

  function clear() {
    queue.length = 0;
    finishActive(false);
  }

  return {
    push,
    dismiss,
    clear,
    onCoachToggle(fn) { hideCoaches = fn || (() => {}); },
    isActive: () => !!active,
  };
}
