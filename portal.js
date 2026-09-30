/* Knees of Fury fighter portal. Open (no login): reads and writes the fn_fighters / fn_bouts tables and
   uploads photos to the fight-photos bucket. Uploaded photos are cut out by a GitHub workflow. */
(function () {
  'use strict';

  const C = window.FN_CLOUD;
  const db = window.supabase.createClient(C.url, C.key, { auth: { persistSession: false } });
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let fighters = [];
  let bouts = [];
  let filter = 'all';
  let query = '';

  // ---------- helpers ----------
  let tt = 0;
  function toast(msg, err) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast on ${err ? 'err' : ''}`;
    clearTimeout(tt);
    tt = setTimeout(() => { t.className = 'toast'; }, 2800);
  }
  const known = (v) => v !== null && v !== undefined && v !== '';
  const photoUrl = (path) => (path ? `${C.url}/storage/v1/object/public/${C.bucket}/${path.split('/').map(encodeURIComponent).join('/')}` : '');
  const byId = (id) => fighters.find((f) => f.id === id);

  // What makes a fighter "complete" for the graphics.
  function checks(f) {
    return [
      ['Photo', !!(f.photo_path || f.photo_raw_path)],
      ['Record', known(f.wins)],
      ['Gym', !!f.gym],
      ['Country', !!f.country],
    ];
  }
  function status(f) {
    const c = checks(f);
    const n = c.filter(([, ok]) => ok).length;
    return n === c.length ? 'done' : n === 0 ? 'none' : 'part';
  }
  function record(f) {
    if (!known(f.wins) && !known(f.losses) && !known(f.draws)) return '';
    if (known(f.wins) && !known(f.losses) && !known(f.draws)) return `${f.wins} wins`;
    return `${f.wins || 0}-${f.losses || 0}-${f.draws || 0}`;
  }

  // ---------- load ----------
  async function load() {
    const [f, b] = await Promise.all([
      db.from('fn_fighters').select('*'),
      db.from('fn_bouts').select('*').order('position'),
    ]);
    if (f.error || b.error) {
      $('#card').innerHTML = `<div class="empty">Couldn't load the card: ${esc((f.error || b.error).message)}</div>`;
      return;
    }
    fighters = f.data;
    bouts = b.data;
    render();
  }

  // ---------- render ----------
  function photoHtml(f) {
    if (f.photo_path) return `<img src="${photoUrl(f.photo_path)}" alt="" loading="lazy">`;
    if (f.photo_raw_path) {
      const label = f.photo_status === 'failed' ? 'Needs a new photo' : 'Being cut out';
      return `<img src="${photoUrl(f.photo_raw_path)}" alt="" loading="lazy"><span class="badge">${label}</span>`;
    }
    return '<span class="none">No photo<br>tap to add</span>';
  }

  function cardHtml(f, corner) {
    if (!f) return `<div class="fcard ${corner}"><div class="ph"><span class="none">TBA</span></div><div class="info"><span class="corner">${corner} corner</span><span class="nm"><span class="l">To be announced</span></span></div></div>`;
    const st = status(f);
    return `<button class="fcard ${corner}" data-id="${f.id}">
      <div class="ph">${photoHtml(f)}</div>
      <div class="info">
        <span class="corner">${corner} corner</span>
        <span class="nm"><span class="f">${esc(f.first)}</span><span class="l">${esc(f.last)}</span></span>
        ${f.nickname ? `<span class="nick">“${esc(f.nickname)}”</span>` : ''}
        <span class="facts">${record(f) ? `<b>${esc(record(f))}</b>` : ''}${esc(f.gym)}${f.country ? ` · ${esc(f.country)}` : ''}</span>
        <span class="checks">${checks(f).map(([n, ok]) => `<span class="chk ${ok ? 'y' : 'n'}">${ok ? '✓' : '✕'} ${n}</span>`).join('')}</span>
      </div>
      <span class="status ${st}">${{ done: 'Complete', part: 'Needs info', none: 'Nothing yet' }[st]}</span>
    </button>`;
  }

  function render() {
    const inCard = new Set(bouts.flatMap((b) => [b.red_id, b.blue_id]));
    const all = fighters.filter((f) => inCard.has(f.id));
    const counts = { done: 0, part: 0, none: 0 };
    all.forEach((f) => { counts[status(f)] += 1; });
    $('#pDone').textContent = counts.done;
    $('#pTotal').textContent = all.length;
    $('#nDone').textContent = counts.done;
    $('#nPart').textContent = counts.part;
    $('#nNone').textContent = counts.none;
    $('#pBar').style.width = `${all.length ? (counts.done / all.length) * 100 : 0}%`;

    const q = query.toLowerCase();
    const show = (f) => {
      if (!f) return filter === 'all' && !q;
      if (filter === 'done' && status(f) !== 'done') return false;
      if (filter === 'todo' && status(f) === 'done') return false;
      return !q || `${f.first} ${f.last} ${f.nickname} ${f.gym}`.toLowerCase().includes(q);
    };
    const html = bouts.map((b, i) => {
      const red = byId(b.red_id);
      const blue = byId(b.blue_id);
      if (!show(red) && !show(blue)) return '';
      const meta = [b.rules, b.weight, `${b.rounds} × ${Math.floor(b.round_len / 60)}:${String(b.round_len % 60).padStart(2, '0')}`].filter(Boolean).join(' · ');
      return `<section class="bout">
        <div class="bout-head"><span class="no">${i + 1}</span>
          <span class="t">${b.label ? `<em>${esc(b.label)}</em>` : ''}${esc(b.title || `${red ? red.last : 'TBA'} vs ${blue ? blue.last : 'TBA'}`)}</span>
          <span class="meta">${esc(meta)}</span>
          <button class="btn edit" data-bout="${b.id}">Edit bout</button></div>
        <div class="pair">${cardHtml(red, 'red')}${cardHtml(blue, 'blue')}</div>
      </section>`;
    }).join('');
    $('#card').innerHTML = html || '<div class="empty">No fighters match.</div>';
  }

  // ---------- sheet ----------
  function openSheet(title, body, foot, mount) {
    const sh = $('#sheet');
    sh.innerHTML = `<div class="sh-head"><h3>${esc(title)}</h3><button class="btn x" data-close>Close</button></div><div class="sh-body">${body}</div><div class="sh-foot">${foot}</div>`;
    sh.classList.add('on');
    $('#scrim').classList.add('on');
    if (mount) mount(sh);
  }
  function closeSheet() { $('#sheet').classList.remove('on'); $('#scrim').classList.remove('on'); }
  $('#scrim').onclick = closeSheet;
  $('#sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });

  const num = (v) => (String(v).trim() === '' ? null : Math.max(0, parseInt(v, 10) || 0));
  const codeFor = (country) => { const hit = (window.COUNTRIES || []).find(([n]) => n.toLowerCase() === String(country).trim().toLowerCase()); return hit ? hit[1] : ''; };

  function openFighter(f) {
    const picks = (window.COUNTRIES || []).slice(0, 12);
    openSheet(`${f.first} ${f.last}`.trim() || 'Fighter', `
      <form id="ff" autocomplete="off">
        <div class="sec">Photo</div>
        <div class="photo-row">
          <div class="ph">${photoHtml(f)}</div>
          <div>
            <label class="btn">Upload photo<input type="file" id="pf" accept="image/*" hidden></label>
            <p>Any clear photo of the fighter facing the camera, head to waist or full body. The background is removed and it's framed to match the others automatically, usually within half an hour.</p>
          </div>
        </div>
        <div class="sec">Details</div>
        <div class="grid">
          <label class="fld"><span>First name</span><input name="first" value="${esc(f.first)}"></label>
          <label class="fld"><span>Last name</span><input name="last" value="${esc(f.last)}"></label>
          <label class="fld"><span>Nickname <em>(optional)</em></span><input name="nickname" value="${esc(f.nickname)}"></label>
        </div>
        <div class="grid">
          <label class="fld"><span>Wins</span><input name="wins" inputmode="numeric" placeholder="?" value="${known(f.wins) ? f.wins : ''}"></label>
          <label class="fld"><span>Losses</span><input name="losses" inputmode="numeric" placeholder="?" value="${known(f.losses) ? f.losses : ''}"></label>
          <label class="fld"><span>Draws</span><input name="draws" inputmode="numeric" placeholder="?" value="${known(f.draws) ? f.draws : ''}"></label>
          <label class="fld"><span>KOs <em>(optional)</em></span><input name="kos" inputmode="numeric" placeholder="?" value="${known(f.kos) ? f.kos : ''}"></label>
        </div>
        <label class="fld"><span>Gym</span><input name="gym" value="${esc(f.gym)}"></label>
        <div class="grid">
          <label class="fld"><span>Country</span><input name="country" list="cl" value="${esc(f.country)}"></label>
          <label class="fld"><span>Code on screen <em>(3 letters)</em></span><input name="code" maxlength="3" value="${esc(f.code)}" style="text-transform:uppercase"></label>
        </div>
        <div class="picks">${picks.map(([n, c]) => `<button type="button" data-country="${esc(n)}" data-code="${c}">${c}</button>`).join('')}</div>
        <datalist id="cl">${(window.COUNTRIES || []).map(([n]) => `<option value="${esc(n)}">`).join('')}</datalist>
        <div class="grid">
          <label class="fld"><span>Age <em>(optional)</em></span><input name="age" inputmode="numeric" value="${known(f.age) ? f.age : ''}"></label>
          <label class="fld"><span>Weight <em>(optional)</em></span><input name="weight" value="${esc(f.weight)}" placeholder="e.g. 67kg"></label>
        </div>
        <label class="fld"><span>Notes for the broadcast team <em>(optional)</em></span><textarea name="notes">${esc(f.notes)}</textarea></label>
      </form>`,
    '<div class="right"><button class="btn" data-close>Cancel</button><button class="btn primary" id="save">Save</button></div>',
    (sh) => {
      const form = $('#ff', sh);
      form.addEventListener('click', (e) => {
        const b = e.target.closest('[data-country]');
        if (b) { form.country.value = b.dataset.country; form.code.value = b.dataset.code; }
      });
      form.country.addEventListener('input', () => { const c = codeFor(form.country.value); if (c) form.code.value = c; });
      $('#pf', sh).addEventListener('change', async (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const path = `raw/${f.id}-${Date.now().toString(36)}.${ext}`;
        toast('Uploading photo…');
        const up = await db.storage.from(C.bucket).upload(path, file, { contentType: file.type || 'image/jpeg' });
        if (up.error) { toast(`Upload failed: ${up.error.message}`, true); return; }
        const res = await db.from('fn_fighters').update({ photo_raw_path: path, photo_status: 'raw' }).eq('id', f.id).select().single();
        if (res.error) { toast(`Couldn't save: ${res.error.message}`, true); return; }
        Object.assign(f, res.data);
        $('.photo-row .ph', sh).innerHTML = photoHtml(f);
        toast('Photo uploaded. It will be cut out and framed shortly.');
        load();
      });
      $('#save', sh).onclick = async () => {
        const v = Object.fromEntries(new FormData(form));
        if (!v.first.trim() && !v.last.trim()) { toast('A fighter needs a name', true); return; }
        const row = {
          first: v.first.trim(), last: v.last.trim(), nickname: v.nickname.trim(),
          wins: num(v.wins), losses: num(v.losses), draws: num(v.draws), kos: num(v.kos),
          gym: v.gym.trim(), country: v.country.trim(), code: v.code.trim().toUpperCase().slice(0, 3),
          age: num(v.age), weight: v.weight.trim(), notes: v.notes.trim(),
        };
        const res = await db.from('fn_fighters').update(row).eq('id', f.id);
        if (res.error) { toast(`Couldn't save: ${res.error.message}`, true); return; }
        closeSheet();
        toast('Saved');
        load();
      };
    });
  }

  const RULES = ['FULL THAI', 'MOD THAI', 'K-1', 'LETHWEI', 'BOXING'];
  function openBout(b) {
    const red = b ? byId(b.red_id) : null;
    const blue = b ? byId(b.blue_id) : null;
    openSheet(b ? 'Edit bout' : 'Add bout', `
      <form id="bf" autocomplete="off">
        <div class="grid">
          <label class="fld"><span>Red corner: first name</span><input name="rf" value="${esc(red ? red.first : '')}"></label>
          <label class="fld"><span>Red corner: last name</span><input name="rl" value="${esc(red ? red.last : '')}"></label>
        </div>
        <div class="grid">
          <label class="fld"><span>Blue corner: first name</span><input name="bf" value="${esc(blue ? blue.first : '')}"></label>
          <label class="fld"><span>Blue corner: last name</span><input name="bl" value="${esc(blue ? blue.last : '')}"></label>
        </div>
        <div class="grid">
          <label class="fld"><span>Rules</span><input name="rules" list="rl" value="${esc(b ? b.rules : 'FULL THAI')}"></label>
          <label class="fld"><span>Weight</span><input name="weight" value="${esc(b ? b.weight : '')}" placeholder="e.g. 67KG"></label>
          <label class="fld"><span>Rounds</span><input name="rounds" inputmode="numeric" value="${b ? b.rounds : 3}"></label>
          <label class="fld"><span>Minutes per round</span><input name="mins" inputmode="decimal" value="${b ? b.round_len / 60 : 2}"></label>
        </div>
        <datalist id="rl">${RULES.map((r) => `<option value="${r}">`).join('')}</datalist>
        <div class="grid">
          <label class="fld"><span>Billing <em>(e.g. MAIN EVENT, optional)</em></span><input name="label" value="${esc(b ? b.label : '')}"></label>
          <label class="fld"><span>Title <em>(e.g. NORTH ISLAND TITLE, optional)</em></span><input name="title" value="${esc(b ? b.title : '')}"></label>
        </div>
      </form>`,
    `${b ? '<button class="btn danger" id="del">Remove bout</button>' : ''}<div class="right"><button class="btn" data-close>Cancel</button><button class="btn primary" id="save">Save</button></div>`,
    (sh) => {
      const form = $('#bf', sh);
      $('#save', sh).onclick = async () => {
        const v = Object.fromEntries(new FormData(form));
        const upsertFighter = async (existing, first, last) => {
          if (!first.trim() && !last.trim()) return existing ? existing.id : null;
          if (existing) {
            if (existing.first !== first.trim() || existing.last !== last.trim()) {
              const r = await db.from('fn_fighters').update({ first: first.trim(), last: last.trim() }).eq('id', existing.id);
              if (r.error) throw r.error;
            }
            return existing.id;
          }
          const r = await db.from('fn_fighters').insert({ first: first.trim(), last: last.trim() }).select().single();
          if (r.error) throw r.error;
          return r.data.id;
        };
        try {
          const row = {
            red_id: await upsertFighter(red, v.rf, v.rl),
            blue_id: await upsertFighter(blue, v.bf, v.bl),
            rules: v.rules.trim().toUpperCase(), weight: v.weight.trim().toUpperCase(),
            rounds: Math.max(1, parseInt(v.rounds, 10) || 3), round_len: Math.round((parseFloat(v.mins) || 2) * 60),
            label: v.label.trim().toUpperCase(), title: v.title.trim().toUpperCase(),
          };
          const r = b
            ? await db.from('fn_bouts').update(row).eq('id', b.id)
            : await db.from('fn_bouts').insert({ ...row, position: (bouts.reduce((m, x) => Math.max(m, x.position), 0) || 0) + 1 });
          if (r.error) throw r.error;
          closeSheet();
          toast('Bout saved');
          load();
        } catch (err) { toast(`Couldn't save: ${err.message}`, true); }
      };
      if (b) {
        let armed = false;
        $('#del', sh).onclick = async (e) => {
          if (!armed) { armed = true; e.currentTarget.textContent = 'Tap again to remove'; return; }
          const r = await db.from('fn_bouts').delete().eq('id', b.id);
          if (r.error) { toast(`Couldn't remove: ${r.error.message}`, true); return; }
          closeSheet();
          toast('Bout removed');
          load();
        };
      }
    });
  }

  // ---------- events ----------
  $('#card').addEventListener('click', (e) => {
    const eb = e.target.closest('[data-bout]');
    if (eb) { openBout(bouts.find((b) => b.id === eb.dataset.bout)); return; }
    const c = e.target.closest('.fcard[data-id]');
    if (c) openFighter(byId(c.dataset.id));
  });
  $('#filter').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    filter = b.dataset.f;
    $$('#filter button').forEach((x) => x.classList.toggle('on', x === b));
    render();
  });
  $('#search').addEventListener('input', (e) => { query = e.target.value.trim(); render(); });
  $('#addBout').onclick = () => openBout(null);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  // Keep the grid fresh while it's open (someone else may be filling it in too).
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#sheet').classList.contains('on')) load(); });
  setInterval(() => { if (!document.hidden && !$('#sheet').classList.contains('on')) load(); }, 30000);
  load();
}());
