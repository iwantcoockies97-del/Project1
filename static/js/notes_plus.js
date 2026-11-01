/* notes_plus.js — нагадування, кольори, закріплення, пошук і чекліст у нотатках.
 *
 * Існуючий код сторінки не змінюється: скрипт знаходить картки нотаток
 * (id береться з кнопки «Змінити»), дістає їхні дані з /api/notes і додає
 * поверх свій інтерфейс. Додаткові дані зберігає ендпоінт /api/notes/{id}/meta
 * (див. note_extras.py).
 *
 * Нагадування спрацьовують, поки сторінка відкрита (навіть у фоновій вкладці).
 * Якщо нагадування настало, коли сторінка була закрита, воно з'явиться одразу
 * після відкриття.
 */
(() => {
    'use strict';

    const rawFetch = window.fetch.bind(window);   // оригінальний fetch, до нашої обгортки
    const JSON_H = { 'Content-Type': 'application/json' };

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const pad = (n) => String(n).padStart(2, '0');

    function el(tag, cls, html) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    }

    const ICON = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
    const SVG = {
        bell: ICON('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
        check: ICON('<path d="M20 6 9 17l-5-5"/>'),
        pin: ICON('<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>'),
        palette: ICON('<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>'),
        plus: ICON('<path d="M12 5v14M5 12h14"/>'),
    };

    const COLORS = [
        { id: '', name: 'Без кольору', hex: '#ffffff' },
        { id: 'yellow', name: 'Жовтий', hex: '#fff3a8' },
        { id: 'pink', name: 'Рожевий', hex: '#ffd6e0' },
        { id: 'mint', name: 'М\'ятний', hex: '#cdf3e0' },
        { id: 'blue', name: 'Блакитний', hex: '#cfe3fe' },
    ];

    /* ------------------------------------------------------------------
       Стан
       ------------------------------------------------------------------ */
    let notes = {};                 // id -> нотатка з API
    const cards = new Map();        // id -> елемент картки
    const firing = new Set();       // id, для яких уже показано спливайку
    let query = '';
    let onlyReminders = false;

    function noteIdOf(card) {
        const b = card.querySelector('[onclick^="editNote("]');
        const m = b && /editNote\((\d+)\)/.exec(b.getAttribute('onclick') || '');
        return m ? Number(m[1]) : null;
    }

    async function setMeta(id, data) {
        const r = await rawFetch('/api/notes/' + id + '/meta', {
            method: 'PUT',
            headers: JSON_H,
            body: JSON.stringify(data),
        });
        if (!r.ok) throw new Error('meta ' + r.status);
        const n = await r.json();
        notes[id] = n;
        refresh(id);
        updateCount();
        applyFilter();
        return n;
    }

    /* ------------------------------------------------------------------
       Час
       ------------------------------------------------------------------ */
    const MONTHS = ['січ.', 'лют.', 'бер.', 'квіт.', 'трав.', 'черв.', 'лип.', 'серп.', 'вер.', 'жовт.', 'лист.', 'груд.'];
    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

    function toLocalInput(ms) {
        const d = new Date(ms);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function whenText(ms) {
        const now = Date.now();
        const diff = ms - now;
        const d = new Date(ms);
        const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;

        if (diff <= 0) {
            const m = Math.floor(-diff / 60000);
            if (m < 1) return 'зараз!';
            if (m < 60) return `прострочено на ${m} хв`;
            if (m < 1440) return `прострочено на ${Math.floor(m / 60)} год`;
            return `прострочено: ${d.getDate()} ${MONTHS[d.getMonth()]}`;
        }
        const m = Math.ceil(diff / 60000);
        const dayDiff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
        if (m <= 1) return 'менше ніж за хвилину';
        if (m < 60) return `через ${m} хв`;
        if (dayDiff === 0 && m < 180) return `через ${Math.floor(m / 60)} год${m % 60 ? ' ' + (m % 60) + ' хв' : ''}`;
        if (dayDiff === 0) return `сьогодні о ${hhmm}`;
        if (dayDiff === 1) return `завтра о ${hhmm}`;
        return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${hhmm}`;
    }

    function presets() {
        const now = Date.now();
        const at = (h, m, addDays) => {
            const d = new Date();
            d.setDate(d.getDate() + addDays);
            d.setHours(h, m, 0, 0);
            return d.getTime();
        };
        const list = [
            { label: 'Через 10 хв', at: now + 10 * 60000 },
            { label: 'Через годину', at: now + 3600000 },
        ];
        if (at(20, 0, 0) > now + 5 * 60000) list.push({ label: 'Сьогодні о 20:00', at: at(20, 0, 0) });
        list.push({ label: 'Завтра о 9:00', at: at(9, 0, 1) });
        return list;
    }

    /* ------------------------------------------------------------------
       Звук і сповіщення
       ------------------------------------------------------------------ */
    let actx = null;

    function unlockAudio() {
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            if (!actx) actx = new AC();
            if (actx.state === 'suspended') actx.resume();
        } catch (e) { /* без звуку теж працює */ }
    }
    ['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, unlockAudio, { once: false, passive: true }));

    /** Дзвіночок: два удари. */
    function ding() {
        if (!actx) return;
        const strike = (at, base) => {
            [1, 2.4].forEach((mult, i) => {
                const o = actx.createOscillator();
                o.type = 'sine';
                o.frequency.value = base * mult;
                const g = actx.createGain();
                const t0 = actx.currentTime + at;
                g.gain.setValueAtTime(0, t0);
                g.gain.linearRampToValueAtTime(i ? 0.07 : 0.22, t0 + 0.01);
                g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1);
                o.connect(g);
                g.connect(actx.destination);
                o.start(t0);
                o.stop(t0 + 1.2);
            });
        };
        strike(0, 880);
        strike(0.38, 1046);
    }

    function askNotifications() {
        try {
            if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
        } catch (e) { /* ignore */ }
    }

    function notifyBrowser(n) {
        try {
            if (!('Notification' in window) || Notification.permission !== 'granted') return;
            const note = new Notification('Нагадування: ' + n.title, { body: (n.text || '').slice(0, 120), tag: 'note-' + n.id });
            note.onclick = () => { window.focus(); note.close(); };
        } catch (e) { /* ignore */ }
    }

    function snack(text) {
        $$('.np-snack').forEach((s) => s.remove());
        const s = el('div', 'np-snack');
        s.textContent = text;
        document.body.append(s);
        setTimeout(() => s.remove(), 2600);
    }

    /* ------------------------------------------------------------------
       Картка нотатки
       ------------------------------------------------------------------ */
    const CHECK_RE = /^(\s*(?:[-*]\s+)?)\[( |x|X)\]\s?(.*)$/;

    function renderText(card, n) {
        const body = card.firstElementChild;
        const p = $('p', body);
        if (!p) return;
        $$('.np-progress', body).forEach((x) => x.remove());

        const lines = (n.text || '').split('\n');
        if (!lines.some((l) => CHECK_RE.test(l))) {
            if (p.dataset.npRich) {
                p.textContent = n.text || '';
                delete p.dataset.npRich;
            }
            return;
        }

        p.dataset.npRich = '1';
        p.textContent = '';
        let total = 0;
        let done = 0;
        lines.forEach((line, i) => {
            const m = CHECK_RE.exec(line);
            if (!m) {
                const d = el('div', 'np-line');
                d.textContent = line || '\u00a0';
                p.append(d);
                return;
            }
            total++;
            const checked = m[2].toLowerCase() === 'x';
            if (checked) done++;
            const label = el('label', 'np-check' + (checked ? ' done' : ''));
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = checked;
            cb.dataset.line = String(i);
            const span = el('span');
            span.textContent = m[3];
            label.append(cb, span);
            p.append(label);
        });

        const pr = el('div', 'np-progress', `<i><b style="width:${Math.round((done / total) * 100)}%"></b></i><span>${done}/${total}</span>`);
        p.after(pr);
    }

    function refresh(id, skipText) {
        const card = cards.get(id);
        const n = notes[id];
        if (!card || !n) return;

        // колір і закріплення
        COLORS.forEach((c) => c.id && card.classList.toggle('c-' + c.id, n.color === c.id));
        card.classList.toggle('is-pinned', !!n.pinned);

        const pinBtn = $('.np-pin', card);
        pinBtn.classList.toggle('on', !!n.pinned);
        pinBtn.lastChild.textContent = n.pinned ? 'Закріплено' : 'Закріпити';

        // нагадування
        const rb = $('.np-remind', card);
        rb.classList.remove('has', 'due', 'done');
        card.classList.remove('is-due');
        if (n.remind_at) {
            if (n.remind_done) {
                rb.classList.add('done');
                rb.innerHTML = `${SVG.check}<span>виконано</span>`;
            } else if (n.remind_at <= Date.now()) {
                rb.classList.add('due');
                card.classList.add('is-due');
                rb.innerHTML = `${SVG.bell}<span>${whenText(n.remind_at)}</span>`;
            } else {
                rb.classList.add('has');
                rb.innerHTML = `${SVG.bell}<span>${whenText(n.remind_at)}</span>`;
            }
        } else {
            rb.innerHTML = `${SVG.plus}<span>Нагадати</span>`;
        }

        if (!skipText) renderText(card, n);
    }

    function updateProgress(card, lines) {
        const items = lines.filter((l) => CHECK_RE.test(l));
        const done = items.filter((l) => CHECK_RE.exec(l)[2].toLowerCase() === 'x').length;
        const pr = $('.np-progress', card);
        if (!pr || !items.length) return;
        $('b', pr).style.width = Math.round((done / items.length) * 100) + '%';
        $('span', pr).textContent = done + '/' + items.length;
    }

    function decorate(card) {
        const id = noteIdOf(card);
        if (id == null || card.dataset.npReady) return;
        card.dataset.npReady = '1';
        card.dataset.noteId = String(id);
        cards.set(id, card);

        const body = card.firstElementChild;
        const meta = el('div', 'np-meta');

        const remind = el('button', 'np-tool np-remind');
        remind.type = 'button';
        remind.addEventListener('click', () => openRemind(id));

        const pin = el('button', 'np-tool np-pin', `${SVG.pin}<span>Закріпити</span>`);
        pin.type = 'button';
        pin.addEventListener('click', async () => {
            const n = notes[id];
            try {
                await setMeta(id, { pinned: !n.pinned });
                applyOrder();
            } catch (e) { snack('Не вдалося закріпити'); }
        });

        const color = el('button', 'np-tool np-color', `${SVG.palette}<span>Колір</span>`);
        color.type = 'button';
        color.addEventListener('click', (e) => {
            e.stopPropagation();
            openPalette(id, color);
        });

        meta.append(remind, pin, color);
        body.append(meta);

        body.addEventListener('change', async (e) => {
            const cb = e.target.closest && e.target.closest('.np-check input');
            if (!cb) return;
            const n = notes[id];
            const lines = (n.text || '').split('\n');
            const i = Number(cb.dataset.line);
            lines[i] = lines[i].replace(CHECK_RE, (_, pre, _x, t) => `${pre}[${cb.checked ? 'x' : ' '}] ${t}`);
            n.text = lines.join('\n');
            cb.closest('label').classList.toggle('done', cb.checked);   // на місці, без перемальовування
            updateProgress(card, lines);
            try {
                await rawFetch('/api/notes/' + id, {
                    method: 'PUT',
                    headers: JSON_H,
                    body: JSON.stringify({ title: n.title, text: n.text }),
                });
            } catch (err) { snack('Не вдалося зберегти галочку'); }
            const all = lines.filter((l) => CHECK_RE.test(l));
            if (all.length && all.every((l) => CHECK_RE.exec(l)[2].toLowerCase() === 'x')) {
                const r = card.getBoundingClientRect();
                if (window.__fun) window.__fun.confetti(r.left + r.width / 2, r.top + r.height / 2, 110);
                snack('Усе зроблено! Бобік пишається.');
            }
        });

        refresh(id);
    }

    /** Закріплені нотатки — нагору (одразу під формою). */
    function applyOrder() {
        const form = $$('.wrap > .card').find((c) => !c.classList.contains('note') && !c.classList.contains('empty'));
        if (!form) return;
        const all = $$('.wrap > .note').sort((a, b) => Number(a.dataset.noteId) - Number(b.dataset.noteId));
        const pinned = all.filter((c) => c.classList.contains('is-pinned'));
        let anchor = form;
        pinned.forEach((c) => { anchor.after(c); anchor = c; });
        // решта — у початковому порядку після закріплених
        all.filter((c) => !c.classList.contains('is-pinned')).forEach((c) => { anchor.after(c); anchor = c; });
    }

    /* ------------------------------------------------------------------
       Палітра
       ------------------------------------------------------------------ */
    let palette = null;

    function closePalette() {
        if (palette) { palette.remove(); palette = null; }
    }

    function openPalette(id, anchorBtn) {
        const same = palette && palette.dataset.id === String(id);
        closePalette();
        if (same) return;
        const pal = el('div', 'np-palette');
        pal.dataset.id = String(id);
        COLORS.forEach((c) => {
            const d = el('button', 'np-dot' + ((notes[id].color || '') === c.id ? ' sel' : ''));
            d.type = 'button';
            d.title = c.name;
            d.setAttribute('aria-label', c.name);
            d.style.background = c.hex;
            d.addEventListener('click', async () => {
                closePalette();
                try { await setMeta(id, { color: c.id || null }); } catch (e) { snack('Не вдалося змінити колір'); }
            });
            pal.append(d);
        });
        document.body.append(pal);
        const r = anchorBtn.getBoundingClientRect();
        const w = pal.offsetWidth;
        pal.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
        const below = r.bottom + 8;
        pal.style.top = (below + pal.offsetHeight > window.innerHeight ? r.top - pal.offsetHeight - 8 : below) + 'px';
        palette = pal;
    }

    document.addEventListener('pointerdown', (e) => {
        if (palette && !palette.contains(e.target) && !e.target.closest('.np-color')) closePalette();
    });
    window.addEventListener('scroll', closePalette, { passive: true });

    /* ------------------------------------------------------------------
       Діалог нагадування
       ------------------------------------------------------------------ */
    let dlg = null;
    let dlgId = null;

    function buildDialog() {
        dlg = el('dialog', 'np-dialog');
        dlg.id = 'npRemindDialog';
        dlg.innerHTML = `
            <h2>Нагадати</h2>
            <p class="np-dlg-note"></p>
            <div class="np-chips"></div>
            <label class="np-field">Або вибери дату й час
                <input type="datetime-local" id="npRemindInput">
            </label>
            <p class="np-hint"></p>
            <div class="dialog-btns">
                <button type="button" class="btn btn-red" data-act="clear">Прибрати</button>
                <button type="button" class="btn btn-gray" data-act="cancel">Скасувати</button>
                <button type="button" class="btn" data-act="save">Зберегти</button>
            </div>`;
        document.body.append(dlg);

        dlg.addEventListener('click', async (e) => {
            const act = e.target.closest('[data-act]');
            if (!act) return;
            const kind = act.dataset.act;
            if (kind === 'cancel') { dlg.close(); return; }

            if (kind === 'clear') {
                dlg.close();
                try {
                    firing.delete(dlgId);
                    await setMeta(dlgId, { remind_at: null });
                    snack('Нагадування прибрано');
                } catch (err) { snack('Не вдалося прибрати'); }
                return;
            }

            const input = $('#npRemindInput', dlg);
            const hint = $('.np-hint', dlg);
            const ms = input.value ? new Date(input.value).getTime() : NaN;
            if (!ms || Number.isNaN(ms)) {
                hint.className = 'np-hint bad';
                hint.textContent = 'Вибери, коли нагадати.';
                return;
            }
            if (ms <= Date.now()) {
                hint.className = 'np-hint bad';
                hint.textContent = 'Цей час уже минув — вибери щось пізніше.';
                return;
            }
            askNotifications();
            unlockAudio();
            dlg.close();
            try {
                firing.delete(dlgId);
                await setMeta(dlgId, { remind_at: ms });
                snack('Нагадаю: ' + whenText(ms));
            } catch (err) { snack('Не вдалося зберегти нагадування'); }
        });
    }

    function openRemind(id) {
        if (!dlg) buildDialog();
        dlgId = id;
        const n = notes[id];
        $('.np-dlg-note', dlg).textContent = '«' + n.title + '»';

        const chips = $('.np-chips', dlg);
        chips.textContent = '';
        const input = $('#npRemindInput', dlg);
        input.min = toLocalInput(Date.now());
        input.value = n.remind_at && !n.remind_done && n.remind_at > Date.now() ? toLocalInput(n.remind_at) : '';
        presets().forEach((p) => {
            const b = el('button', 'np-tool');
            b.type = 'button';
            b.textContent = p.label;
            b.addEventListener('click', () => {
                input.value = toLocalInput(p.at);
                const hint = $('.np-hint', dlg);
                hint.className = 'np-hint';
                hint.textContent = 'Нагадаю: ' + whenText(p.at) + '.';
            });
            chips.append(b);
        });

        const hint = $('.np-hint', dlg);
        hint.className = 'np-hint';
        const supported = 'Notification' in window;
        if (supported && Notification.permission === 'denied') {
            hint.textContent = 'Сповіщення браузера вимкнені — нагадаю на сторінці зі звуком.';
        } else if (supported && Notification.permission === 'default') {
            hint.textContent = 'Спрацює, поки сторінка відкрита (хоч би у фоновій вкладці). Браузер спитає дозвіл на сповіщення.';
        } else {
            hint.textContent = 'Спрацює, поки сторінка відкрита (хоч би у фоновій вкладці).';
        }

        $('[data-act="clear"]', dlg).style.display = n.remind_at ? '' : 'none';
        dlg.showModal();
    }

    /* ------------------------------------------------------------------
       Спрацювання нагадування
       ------------------------------------------------------------------ */
    const toastBox = el('div', 'np-toasts');
    document.body.append(toastBox);
    const baseTitle = document.title;

    function updateTitle() {
        document.title = toastBox.children.length ? '⏰ Нагадування — ' + baseTitle : baseTitle;
    }

    function fire(n) {
        firing.add(n.id);

        const overdueMin = Math.floor((Date.now() - n.remind_at) / 60000);
        const t = el('div', 'np-toast');
        t.innerHTML = '<small>Нагадування</small><h4></h4><p></p><div class="np-toast-btns"></div>';
        $('h4', t).textContent = n.title;
        $('p', t).textContent = (n.text || '').replace(/\[( |x|X)\]\s?/g, '');
        if (overdueMin >= 2) $('small', t).textContent = `Нагадування · ${whenText(n.remind_at)}`;

        const btns = $('.np-toast-btns', t);
        const mk = (cls, label, fn) => {
            const b = el('button', 'btn ' + cls);
            b.type = 'button';
            b.textContent = label;
            b.addEventListener('click', async () => {
                t.remove();
                updateTitle();
                try { await fn(b); } catch (e) { snack('Не вдалося зберегти'); }
            });
            btns.append(b);
        };
        mk('', 'Готово ✓', async () => {
            const r = t.getBoundingClientRect();
            await setMeta(n.id, { remind_done: true });
            if (window.__fun) window.__fun.confetti(r.left + r.width / 2, r.top, 90);
        });
        mk('btn-gray', '+10 хв', async () => {
            firing.delete(n.id);
            await setMeta(n.id, { remind_at: Date.now() + 10 * 60000 });
            snack('Нагадаю через 10 хв');
        });
        mk('btn-gray', '+1 год', async () => {
            firing.delete(n.id);
            await setMeta(n.id, { remind_at: Date.now() + 3600000 });
            snack('Нагадаю через годину');
        });

        toastBox.append(t);
        updateTitle();
        refresh(n.id);

        ding();
        notifyBrowser(n);
        if (window.__fun && document.visibilityState === 'visible') setTimeout(() => window.__fun.peek(2), 500);
    }

    function tick() {
        if (document.getElementById('dog-layer')) return;   // не заважаємо псу їсти
        const now = Date.now();
        for (const n of Object.values(notes)) {
            if (n.remind_at && !n.remind_done && now >= n.remind_at && !firing.has(n.id) && cards.has(n.id)) fire(n);
        }
    }

    let tickCount = 0;
    setInterval(() => {
        tick();
        if (++tickCount % 10 === 0) cards.forEach((_, id) => refresh(id, true));   // оновлюємо «через N хв»
    }, 1000);

    /* ------------------------------------------------------------------
       Пошук і лічильник нагадувань
       ------------------------------------------------------------------ */
    let searchInput = null;
    let countChip = null;
    let noResult = null;

    function updateCount() {
        if (!countChip) return;
        const k = Object.values(notes).filter((n) => n.remind_at && !n.remind_done && cards.has(n.id)).length;
        countChip.textContent = 'Нагадувань: ' + k;
        countChip.classList.toggle('on', onlyReminders);
    }

    function applyFilter() {
        const q = query.trim().toLowerCase();
        let shown = 0;
        cards.forEach((card, id) => {
            const n = notes[id];
            if (!n) return;
            const hay = (n.title + ' ' + (n.text || '')).toLowerCase();
            const ok = (!q || hay.includes(q)) && (!onlyReminders || (n.remind_at && !n.remind_done));
            card.classList.toggle('np-hide', !ok);
            if (ok) shown++;
        });
        if (noResult) noResult.classList.toggle('np-hide', shown > 0 || cards.size === 0);
    }

    function buildSearch() {
        const top = $('.wrap > .top');
        const form = $$('.wrap > .card').find((c) => !c.classList.contains('note') && !c.classList.contains('empty'));
        if (!top || !form) return;

        const bar = el('div', 'np-search');
        searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.placeholder = 'Пошук по нотатках…  ( / )';
        searchInput.setAttribute('aria-label', 'Пошук по нотатках');
        searchInput.addEventListener('input', () => { query = searchInput.value; applyFilter(); });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { searchInput.value = ''; query = ''; applyFilter(); searchInput.blur(); }
        });

        countChip = el('button', 'count np-count');
        countChip.type = 'button';
        countChip.title = 'Показати лише нотатки з нагадуванням';
        countChip.addEventListener('click', () => {
            onlyReminders = !onlyReminders;
            updateCount();
            applyFilter();
        });

        bar.append(searchInput, countChip);
        top.after(bar);

        noResult = el('div', 'np-noresult np-hide');
        noResult.textContent = 'Нічого не знайшов';
        form.after(noResult);

        document.addEventListener('keydown', (e) => {
            if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
            const t = e.target;
            if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
            e.preventDefault();
            searchInput.focus();
        });
    }

    /* ------------------------------------------------------------------
       Нагадування прямо в формі додавання нотатки
       ------------------------------------------------------------------ */
    function buildFormRow() {
        const addBtn = $('[onclick*="addNote"]');
        if (!addBtn) return;

        const row = el('div', 'np-formrow');
        const label = el('span');
        label.textContent = 'Нагадати:';
        const input = document.createElement('input');
        input.type = 'datetime-local';
        input.id = 'npRemind';
        input.setAttribute('aria-label', 'Нагадати (необов\'язково)');
        input.min = toLocalInput(Date.now());
        row.append(label);
        presets().forEach((p) => {
            const b = el('button', 'np-tool');
            b.type = 'button';
            b.textContent = p.label.replace('Через ', '+').replace('годину', '1 год').replace('Сьогодні о ', 'о ').replace('Завтра о ', 'завтра ');
            b.title = p.label;
            b.addEventListener('click', () => { input.value = toLocalInput(p.at); });
            row.append(b);
        });
        row.append(input);
        addBtn.before(row);

        addBtn.addEventListener('click', () => {
            if (input.value) { askNotifications(); unlockAudio(); }
        }, true);

        const text = $('#text');
        if (text) {
            text.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addBtn.click(); }
            });
        }
    }

    // Обгортка fetch: коли оригінальний addNote() створює нотатку, ставимо їй нагадування
    window.fetch = function (input, init) {
        let wantsReminder = null;
        try {
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            if (init && init.method === 'POST' && /\/api\/notes\/?$/.test(url)) {
                const v = ($('#npRemind') || {}).value;
                wantsReminder = v ? new Date(v).getTime() : null;
            }
        } catch (e) { /* ignore */ }

        const p = rawFetch(input, init);
        if (!wantsReminder || Number.isNaN(wantsReminder)) return p;
        return p.then(async (res) => {
            if (res.ok) {
                try {
                    const created = await res.clone().json();
                    await rawFetch('/api/notes/' + created.id + '/meta', {
                        method: 'PUT',
                        headers: JSON_H,
                        body: JSON.stringify({ remind_at: wantsReminder }),
                    });
                } catch (e) { /* нотатку створено, просто без нагадування */ }
            }
            return res;
        });
    };

    /* ------------------------------------------------------------------
       Старт
       ------------------------------------------------------------------ */
    async function init() {
        buildSearch();
        buildFormRow();
        try {
            const r = await rawFetch('/api/notes');
            const list = await r.json();
            notes = Object.fromEntries(list.map((n) => [n.id, n]));
        } catch (e) {
            return;   // без API лишаємо сторінку як є
        }
        $$('.wrap > .note').forEach(decorate);
        applyOrder();
        updateCount();
        applyFilter();
        tick();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
