import { busy, replaceKids } from './ui.js';

// Invite (Broadcast Pass): links, QR codes and the invite dialog.
// Created by app.js through createInvite(app): `app` carries the studio state and helpers this part uses.
export function createInvite(app) {
  const {
    $, $$, store, MAX, S, isHost, normalizeHex, hexLuminance, toast, linkKind, parseCode, copy, inviteLink,
    shortInviteUrl, preferredInviteUrl, api, creds, participants, mixHex, qrReadyFor, needAccountThen,
    openWizard, renderSocialMatrix, guideMark, openEnter
  } = app;

  // ---------------------------------------------------------------- invite (Broadcast Pass)
  let invQrMode = 'guest';

  function flashBtn(btn, msg) {
    if (!btn) return;
    const span = btn.querySelector('span');
    const use = btn.querySelector('svg use');
    if (!btn.dataset.origLabel && span) btn.dataset.origLabel = span.textContent;
    if (!btn.dataset.origIcon && use) btn.dataset.origIcon = use.getAttribute('href') || '';
    btn.classList.add('inv-copied');
    if (span) span.textContent = msg;
    if (use) use.setAttribute('href', '/icons.svg#i-check');
    clearTimeout(btn._invT);
    btn._invT = setTimeout(() => {
      btn.classList.remove('inv-copied');
      if (span && btn.dataset.origLabel) span.textContent = btn.dataset.origLabel;
      if (use && btn.dataset.origIcon) use.setAttribute('href', btn.dataset.origIcon);
    }, 1800);
  }

  async function renderInviteQr() {
    const cv = $('#inviteQrCanvas');
    if (!cv || !S.studio) return;
    const url = invQrMode === 'watch' ? app.watchLinkUrl() : preferredInviteUrl();
    if ($('#inviteQrTitle')) {
      $('#inviteQrTitle').textContent = invQrMode === 'watch' ? 'Audience watch QR' : 'Scan with phone camera';
    }
    if ($('#inviteQrCap')) {
      $('#inviteQrCap').textContent = invQrMode === 'watch'
        ? 'Audience watch page: show, live chat & voice questions'
        : 'Scan from a phone or second camera to join the green room';
    }
    const q = await qrReadyFor(url);
    if (!q) return;
    const size = 240, pad = 8;
    cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    const n = q.getModuleCount();
    const cell = Math.max(1, Math.floor((size - pad * 2) / n));
    const real = cell * n;
    const ox = Math.floor((size - real) / 2), oy = Math.floor((size - real) / 2);
    ctx.fillStyle = '#070c1a';
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (q.isDark(i, j)) ctx.fillRect(ox + j * cell, oy + i * cell, cell, cell);
  }

  function renderInviteSeats(list) {
    const box = $('#inviteSeats');
    if (!box) return;
    // Rebuild only when who's here changes: renderAll runs on every stage update, and replacing the seat under the
    // pointer between press and release swallowed the click ("nothing happens").
    const key = list.slice(0, MAX).map((p) => `${p.id}:${p.name}:${!!p.me}`).join('|') + '|' + (S.state?.brand?.color || '');
    if (box.dataset.k === key) return;
    box.dataset.k = key;
    const slots = [];
    const accent = normalizeHex(S.state?.brand?.color) || '#3b82f6';
    const palette = [accent, mixHex(accent, '#000000', 0.3), '#10b981', '#f59e0b', mixHex(accent, '#ffffff', 0.35), '#06b6d4'];
    for (let i = 0; i < MAX; i++) {
      const p = list[i];
      if (p) {
        const el = document.createElement('div');
        el.className = 'inv-seat live';
        const av = document.createElement('span');
        av.className = 'inv-seat-av';
        const bg = palette[i % palette.length];
        av.style.background = bg;
        av.style.color = hexLuminance(bg) > 0.42 ? '#070c1a' : '#ffffff';
        av.textContent = (p.name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
        const nm = document.createElement('span');
        nm.className = 'inv-seat-name';
        nm.textContent = p.me ? `${p.name} (You)` : p.name;
        el.append(av, nm);
        slots.push(el);
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'inv-seat open';
        btn.setAttribute('aria-label', `Seat ${i + 1} open: invite a guest`);
        btn.title = 'Invite a guest to this seat';
        const av = document.createElement('span');
        av.className = 'inv-seat-av';
        av.innerHTML = '<svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-plus"/></svg>';
        const nm = document.createElement('span');
        nm.className = 'inv-seat-name';
        nm.textContent = 'Invite';
        btn.append(av, nm);
        btn.onclick = async () => {
          const url = preferredInviteUrl();
          guideMark('invited');
          // Phones (and some desktops) get the share sheet; everyone else gets the link on the clipboard.
          if (navigator.share && matchMedia('(pointer: coarse)').matches) {
            try { await navigator.share({ title: `Join ${S.state?.title || 'my show'} on gather`, text: 'Come on the show:', url }); return; } catch (e) { if (e?.name === 'AbortError') return; }
          }
          copy(url, `Invite link copied. Send it to your guest: they land in seat ${i + 1}'s green room.`);
          btn.classList.add('copied');
          av.innerHTML = '<svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-check"/></svg>';
          nm.textContent = 'Link copied';
          setTimeout(() => { btn.classList.remove('copied'); av.innerHTML = '<svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-plus"/></svg>'; nm.textContent = 'Invite'; }, 2200);
        };
        slots.push(btn);
      }
    }
    replaceKids(box, ...slots);
  }

  function renderInviteShort() {
    const shortUrl = shortInviteUrl();
    const has = !!shortUrl;
    if ($('#inviteShortIdle')) $('#inviteShortIdle').hidden = has;
    if ($('#inviteShortReady')) $('#inviteShortReady').hidden = !has;
    if ($('#inviteShortMeta')) {
      if (has) {
        const saved = inviteLink().length - shortUrl.length;
        $('#inviteShortMeta').textContent = saved > 0 ? `${shortUrl.length} chars (-${saved})` : `${shortUrl.length} chars`;
      } else {
        $('#inviteShortMeta').textContent = 'Compact /s/ URL';
      }
    }
    if ($('#inviteShortUrl')) {
      $('#inviteShortUrl').textContent = has ? shortUrl.replace(/^https?:\/\/(www\.)?/, '') : '—';
      $('#inviteShortUrl').title = shortUrl || '';
    }
  }

  async function generateShortInvite(rotate = false) {
    if (!S.studio) return '';
    const trigger = rotate ? $('#regenShortLink') : $('#genShortLink');
    busy(trigger);
    try {
      const r = await api('inviteShort', { ...creds(), rotate });
      S.shortInvite = r.short || '';
      renderInviteDialog();
      toast(rotate ? 'Generated a new short invite link.' : 'Short SMS invite link ready.');
      return shortInviteUrl();
    } catch (e) {
      toast(e.message || 'Could not generate short link.', { err: true });
      return '';
    } finally {
      busy(trigger, false);
    }
  }

  function renderInviteDialog() {
    if (!S.studio) return;
    const list = participants(), n = list.length;
    $('#inviteCode').textContent = S.studio;
    if ($('#inviteFullUrl')) $('#inviteFullUrl').textContent = inviteLink().replace(/^https?:\/\/(www\.)?/, '');
    $('#inviteWatch').textContent = app.watchLinkText();
    if ($('#inviteSeatCount')) $('#inviteSeatCount').textContent = `${n} / ${MAX} live`;
    $('#inviteFine').textContent = `Anyone with this code can join. ${n} of ${MAX} seats taken.${isHost() ? ' Keep this tab open while hosting.' : ''}`;
    if ($('#shareInviteBtn')) $('#shareInviteBtn').hidden = !navigator.share;
    renderInviteShort();
    renderInviteSeats(list);
    renderInviteQr();
    renderSocialMatrix($('#invSocialMatrix'));
  }

  if ($('#invDoneBtn')) $('#invDoneBtn').onclick = () => $('#inviteDlg').close();

  function openInvite() {
    if (!S.studio) return openWizard('now');
    renderInviteDialog();
    inviteOpener = document.activeElement !== document.body ? document.activeElement : null;
    $('#inviteDlg').showModal();
  }
  let inviteOpener = null;
  // When the studio opened the invite dialog by itself, focus would fall to <body>: land on Invite instead.
  $('#inviteDlg').addEventListener('close', () => {
    const back = inviteOpener?.isConnected && !inviteOpener.closest('[hidden]') ? inviteOpener : [$('#enterTop'), $('#micBtn')].find((b) => b && !b.hidden && b.offsetParent);
    inviteOpener = null;
    // Only if focus is still lost: on a busy page this runs late, and must not pull a user back from where they went.
    setTimeout(() => { const at = document.activeElement; if (!at || at === document.body || $('#inviteDlg').contains(at)) back?.focus(); }, 0);
  });
  $('#autoStage').checked = store.get('autoStage', false);
  $('#autoStage').onchange = (e) => store.set('autoStage', e.target.checked);
  $('#noteLink').onclick = () => { copy(preferredInviteUrl(), 'Invite link copied.'); guideMark('invited'); };
  $('#noteCode').onclick = () => { copy(S.studio, 'Studio code copied.'); guideMark('invited'); };
  $('#copyCode').onclick = () => { copy(S.studio, 'Room code copied.'); guideMark('invited'); flashBtn($('#copyCode'), 'Copied'); };
  $('#copyLink').onclick = () => { copy(inviteLink(), 'Invite link copied.'); guideMark('invited'); flashBtn($('#copyLink'), 'Copied link'); };
  $('#genShortLink').onclick = () => generateShortInvite(false);
  $('#regenShortLink').onclick = () => generateShortInvite(true);
  $('#copyShortLink').onclick = () => {
    const url = shortInviteUrl();
    if (!url) return;
    copy(url, 'Short SMS link copied.');
    guideMark('invited');
    flashBtn($('#copyShortLink'), 'Copied');
  };
  $('#smsInviteBtn').onclick = async () => {
    const url = shortInviteUrl() || await generateShortInvite(false);
    if (!url) return;
    const show = S.state?.title ? `"${S.state.title}"` : 'my live gather studio';
    const msg = `Join ${show} in the green room: ${url}`;
    try { await navigator.clipboard.writeText(msg); } catch {}
    guideMark('invited');
    flashBtn($('#smsInviteBtn'), 'SMS ready');
    toast('SMS invite ready & copied to clipboard.');
    const a = document.createElement('a');
    a.href = `sms:?&body=${encodeURIComponent(msg)}`;
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    a.remove();
  };
  $('#copyInviteMsg').onclick = () => {
    const show = S.state?.title ? `"${S.state.title}"` : 'my live studio';
    copy(`Join ${show} in the gather green room: ${preferredInviteUrl()} (Room code: ${S.studio})`, 'Invite message copied.');
    guideMark('invited');
    flashBtn($('#copyInviteMsg'), 'Copied');
  };
  $('#emailInviteBtn').onclick = () => {
    const show = S.state?.title || 'Live studio on gather';
    const sub = encodeURIComponent(`Join me live: ${show}`);
    const body = encodeURIComponent(`Join the green room to check your camera and mic:\n${preferredInviteUrl()}\n\nRoom code: ${S.studio}`);
    location.href = `mailto:?subject=${sub}&body=${body}`;
    guideMark('invited');
  };
  $('#shareInviteBtn').onclick = async () => {
    try { await navigator.share({ title: S.state?.title || 'Join my gather studio', text: `Join the green room (code: ${S.studio})`, url: preferredInviteUrl() }); guideMark('invited'); } catch {}
  };
  $$('.inv-qr-tabs button').forEach((b) => b.onclick = () => {
    invQrMode = b.dataset.qr === 'watch' ? 'watch' : 'guest';
    $$('.inv-qr-tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    renderInviteQr();
  });
  $('#downloadQr').onclick = () => {
    const cv = $('#inviteQrCanvas');
    if (!cv) return;
    const a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = invQrMode === 'watch' ? `gather-watch-qr-${app.watchSlug()}.png` : `gather-guest-qr-${S.shortInvite || S.studio}.png`;
    a.click();
    toast('QR image downloaded.');
  };
  $('#addSlot').onclick = openInvite;
  $('#enterTop').onclick = openInvite;
  $('#heroSchedule').onclick = () => openWizard('later');
  // Go Live Now: sign in (or create an account) first, then Start a broadcast. Nobody starts a stream signed out.
  $('#enterStage').onclick = () => needAccountThen(() => openWizard('now'));
  $('#landJoin').addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = $('#landCode').value, code = parseCode(raw), kind = linkKind(raw);
    if (!code) { $('#landCode').focus(); return toast('Paste the invite link or code you were sent.', { err: true }); }
    if (kind === 'w') return toast('That’s a watch link, for viewers.', { action: ['Open it', () => { location.href = '/w/' + code; }], ms: 8000 });
    if (kind === 'c') S.callin = true;
    openEnter('join', code);
  });
  $('#recDlg').addEventListener('close', () => { $('#recVideo').pause(); });
  // Close buttons inside forms are type="button", so Enter submits the form instead of closing the dialog.
  $$('button[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog')?.close('cancel')));
  return { flashBtn, renderInviteDialog, openInvite };
}
