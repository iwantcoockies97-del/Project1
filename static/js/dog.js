/* dog.js — натисни G: пес вбігає на сторінку і з'їдає її (ХАВ-ХАВ-ХАВ).
 *
 * Сторінка не змінюється: пес малює «відкушені діри» на прозорому canvas
 * поверх неї і потім усе повертається. Дані, нотатки та DOM не чіпаються.
 * Повторне G (або Esc) під час поїдання — пес тікає, сторінка повертається.
 */
(() => {
    'use strict';

    const ASSETS = {
        closed: '/static/img/dog_closed.png',
        open: '/static/img/dog_open.png',
        sound: '/static/audio/bark.mp3',
        poop: '/static/img/dog_poop.png',
    };

    // другий пес (присів): де з нього «виходить» комок і де земля — частки розміру фото
    const POOP_EXIT = { x: 0.665, y: 0.6 };
    const POOP_GROUND = 0.965;

    const CYCLE = 0.14;       // секунд на одне «хап» (швидко: ХАВ-ХАВ-ХАВ)
    const OPEN_FRAC = 0.58;   // яку частину циклу рот відкритий
    const MOUTH = { x: 0.24, y: 0.58 };   // де пащека на кадрі (частка розміру)
    const MAX_EAT_SEC = 8;    // найдовше поїдання, навіть для великих сторінок

    /* ------------------------------------------------------------------
       Завантажуємо ресурси наперед
       ------------------------------------------------------------------ */
    [ASSETS.closed, ASSETS.open, ASSETS.poop].forEach((src) => { new Image().src = src; });
    const soundData = fetch(ASSETS.sound).then((r) => r.arrayBuffer()).catch(() => null);

    /* ------------------------------------------------------------------
       Звук (Web Audio): ріжемо mp3 на окремі гавкання
       ------------------------------------------------------------------ */
    let actx = null;
    let abuf = null;

    function unlockAudio() {
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            if (!actx) actx = new AC();
            if (actx.state === 'suspended') actx.resume();
            if (!abuf) {
                soundData
                    .then((d) => (d ? actx.decodeAudioData(d.slice(0)) : null))
                    .then((b) => { abuf = b; })
                    .catch(() => {});
            }
        } catch (e) { /* без звуку теж працює */ }
    }

    function bark({ offset = 0, dur = null, rate = 1, gain = 0.85 } = {}) {
        if (!actx || !abuf) return;
        const d = dur == null ? abuf.duration - offset : dur;
        const len = d / rate;
        const t0 = actx.currentTime;
        const src = actx.createBufferSource();
        src.buffer = abuf;
        src.playbackRate.value = rate;
        const g = actx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
        g.gain.setValueAtTime(gain, t0 + Math.max(0.008, len - 0.04));
        g.gain.linearRampToValueAtTime(0, t0 + len);
        src.connect(g);
        g.connect(actx.destination);
        src.start(t0, offset, d);
    }

    // «пххх» натуги і «плюх» — синтезуємо, щоб не потрібні були додаткові файли
    function strainSound(dur) {
        if (!actx) return;
        const t0 = actx.currentTime;
        const o = actx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(90, t0);
        o.frequency.linearRampToValueAtTime(52, t0 + dur);
        const lfo = actx.createOscillator();
        lfo.frequency.value = 15;
        const lg = actx.createGain();
        lg.gain.value = 14;
        lfo.connect(lg);
        lg.connect(o.frequency);
        const f = actx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 380;
        const g = actx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.35, t0 + 0.15);
        g.gain.setValueAtTime(0.35, t0 + dur - 0.2);
        g.gain.linearRampToValueAtTime(0, t0 + dur);
        o.connect(f);
        f.connect(g);
        g.connect(actx.destination);
        o.start(t0); lfo.start(t0);
        o.stop(t0 + dur); lfo.stop(t0 + dur);
    }

    function plopSound(strength = 1) {
        if (!actx) return;
        const t0 = actx.currentTime;
        const o = actx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(300, t0);
        o.frequency.exponentialRampToValueAtTime(75, t0 + 0.16);
        const g = actx.createGain();
        g.gain.setValueAtTime(0.7 * strength, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
        o.connect(g);
        g.connect(actx.destination);
        o.start(t0);
        o.stop(t0 + 0.22);
    }

    // два гавкання в файлі: ~0.14–0.48с та ~0.46–0.78с
    const SLICES = [[0.14, 0.34], [0.46, 0.32]];
    function chompBark(n) {
        const [offset, dur] = SLICES[n % 2];
        bark({ offset, dur, rate: 0.88 + Math.random() * 0.26 });
    }

    /* ------------------------------------------------------------------
       Допоміжне
       ------------------------------------------------------------------ */
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const rand = (a, b) => a + Math.random() * (b - a);
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    const easeIn = (t) => t * t * t;

    function cssVar(name, fallback) {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v || fallback;
    }

    /** Прямокутники того, що на сторінці є «їжею»: текст, кнопки, поля, картки. */
    function collectContentRects() {
        const out = [];
        const sx = window.scrollX;
        const sy = window.scrollY;
        const push = (r) => {
            if (r.width < 2 || r.height < 2) return;
            out.push({ left: r.left + sx, right: r.right + sx, top: r.top + sy, bottom: r.bottom + sy });
        };

        const scan = (node) => {
            if (node.nodeType === 3) {
                if (!node.nodeValue.trim()) return;
                const range = document.createRange();
                range.selectNodeContents(node);
                for (const rc of range.getClientRects()) push(rc);
                return;
            }
            if (node.nodeType !== 1) return;
            if (node.id === 'dog-layer') return;
            if (/^(SCRIPT|STYLE|NOSCRIPT|DIALOG|TEMPLATE|HEAD)$/.test(node.tagName)) return;

            const cs = getComputedStyle(node);
            if (cs.display === 'none' || cs.visibility === 'hidden') return;

            const interactive = /^(INPUT|TEXTAREA|BUTTON|IMG|SELECT|SVG|CANVAS|VIDEO)$/i.test(node.tagName);
            const hasBox =
                (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') ||
                cs.backgroundImage !== 'none' ||
                cs.boxShadow !== 'none' ||
                (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none');
            if (interactive || hasBox) push(node.getBoundingClientRect());

            node.childNodes.forEach(scan);
        };

        document.body.childNodes.forEach(scan);
        return out;
    }

    /** Змійка рядками по вмісту. Повертає точки, по яких іде морда. */
    function planPath(rects, R, rowStep, docW, docH) {
        let list = rects;
        if (!list.length) {
            list = [{ left: docW * 0.2, right: docW * 0.8, top: docH * 0.3, bottom: docH * 0.7 }];
        }
        const minY = Math.min(...list.map((r) => r.top));
        const maxY = Math.max(...list.map((r) => r.bottom));

        const rows = [];
        for (let y = minY + rowStep * 0.45; y - rowStep * 0.6 <= maxY; y += rowStep) {
            const hit = list.filter((r) => r.bottom > y - rowStep * 0.6 && r.top < y + rowStep * 0.6);
            if (!hit.length) continue;
            const x0 = Math.min(...hit.map((r) => r.left));
            const x1 = Math.max(...hit.map((r) => r.right));
            let a = x0 + R * 0.25;
            let b = x1 - R * 0.25;
            if (b - a < R * 0.5) { const m = (a + b) / 2; a = m - R * 0.25; b = m + R * 0.25; }
            rows.push({ y, a, b });
        }

        const pts = [];
        rows.forEach((row, i) => {
            if (i % 2 === 0) pts.push({ x: row.b, y: row.y }, { x: row.a, y: row.y });   // справа наліво
            else pts.push({ x: row.a, y: row.y }, { x: row.b, y: row.y });               // зліва направо
        });
        return pts;
    }

    function pathLength(pts) {
        let L = 0;
        for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        return L;
    }

    /* ------------------------------------------------------------------
       Один запуск
       ------------------------------------------------------------------ */
    let running = false;
    let current = null;

    function frameLoop(S, fn) {
        return new Promise((resolve) => {
            let last = performance.now();
            const step = (now) => {
                if (S.cancelled) { resolve(false); return; }
                const dt = Math.min(0.05, (now - last) / 1000);
                last = now;
                if (fn(dt)) { resolve(true); return; }
                requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        });
    }

    function wait(S, sec) {
        let t = 0;
        return frameLoop(S, (dt) => { t += dt; return t >= sec; });
    }


    /** Комок зім'ятого паперу, намальований на canvas. */
    function makeLump(size) {
        const dpr = 2;
        const c = document.createElement('canvas');
        c.width = c.height = size * dpr;
        c.style.width = c.style.height = size + 'px';
        const g = c.getContext('2d');
        g.scale(dpr, dpr);
        const cx = size / 2;
        const cy = size / 2;
        const R = size * 0.46;
        const n = 22;
        const ring = [];
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            const r = R * rand(0.8, 1);
            ring.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
        const path = () => {
            g.beginPath();
            ring.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
            g.closePath();
        };
        path();
        g.fillStyle = '#e8edf6';
        g.fill();
        g.save();
        path();
        g.clip();

        const hub = [cx + rand(-R * 0.2, R * 0.2), cy + rand(-R * 0.2, R * 0.2)];
        const light = -2.3;   // світло зверху-зліва
        for (let i = 0; i < n; i++) {
            const a = ring[i];
            const b = ring[(i + 1) % n];
            const mid = Math.atan2((a[1] + b[1]) / 2 - cy, (a[0] + b[0]) / 2 - cx);
            const l = 82 + 14 * Math.cos(mid - light) + rand(-9, 9);
            g.beginPath();
            g.moveTo(hub[0], hub[1]);
            g.lineTo(a[0], a[1]);
            g.lineTo(b[0], b[1]);
            g.closePath();
            g.fillStyle = `hsl(222, 28%, ${l}%)`;
            g.fill();
        }
        // заломи
        g.lineWidth = 1;
        for (let i = 0; i < 10; i++) {
            const a = ring[(Math.random() * n) | 0];
            const b = ring[(Math.random() * n) | 0];
            g.strokeStyle = `rgba(31,58,147,${rand(0.12, 0.3)})`;
            g.beginPath();
            g.moveTo(a[0], a[1]);
            g.quadraticCurveTo(hub[0] + rand(-12, 12), hub[1] + rand(-12, 12), b[0], b[1]);
            g.stroke();
        }
        // клаптик скотчу з нотаток і шматочок «рукопису»
        g.save();
        g.translate(cx + rand(-R * 0.3, R * 0.3), cy + rand(-R * 0.3, R * 0.3));
        g.rotate(rand(-0.9, 0.9));
        g.fillStyle = 'rgba(255,224,102,0.85)';
        g.fillRect(-size * 0.1, -size * 0.04, size * 0.2, size * 0.08);
        g.restore();
        g.strokeStyle = 'rgba(31,58,147,0.55)';
        g.lineWidth = 1.6;
        for (let i = 0; i < 3; i++) {
            const x = cx + rand(-R * 0.5, R * 0.2);
            const y = cy + rand(-R * 0.5, R * 0.5);
            g.beginPath();
            g.moveTo(x, y);
            g.bezierCurveTo(x + 6, y - 5, x + 12, y + 5, x + rand(16, 26), y);
            g.stroke();
        }
        g.restore();
        path();
        g.strokeStyle = 'rgba(14,26,58,0.35)';
        g.lineWidth = 1.5;
        g.stroke();
        return c;
    }

    /** Перший пес тікає геть. */
    function exitEater(S, minT) {
        const D = S.D;
        const W = S.W;
        if (!D || S.eaterGone) return Promise.resolve();
        const exitRight = D.x > S.docW / 2;
        const fromX = D.x;
        const toX = exitRight ? S.docW + W * 0.4 : -W * 0.9;
        D.flip = exitRight;
        D.open = false;
        let t = 0;
        return frameLoop(S, (dt) => {
            t += dt;
            const p = clamp(t / 0.55, 0, 1);
            D.x = fromX + (toX - fromX) * easeIn(p);
            D.rot = Math.sin(t * 40) * 1.5;
            S.dogEl.dataset.open = '0';
            S.dogEl.style.transform = `translate3d(${D.x - MOUTH.x * W}px, ${D.y - MOUTH.y * ((W * 520) / 500)}px, 0)`;
            S.dogEl.firstChild.style.transform = `scaleX(${D.flip ? -1 : 1}) rotate(${D.rot}deg)`;
            return p >= 1 && t > (minT || 0);
        }).then((ok) => {
            if (ok) { S.eaterGone = true; S.dogEl.style.display = 'none'; }
        });
    }

    /** Прибігає другий пес, присідає і виплоджує комок сторінки. */
    async function poopScene(S) {
        const layer = S.layer;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const W2 = Math.round(clamp(vw * 0.42, 240, 520));
        const K2 = W2 / 420;

        const img = new Image();
        img.className = 'poop-img';
        img.alt = '';
        img.src = ASSETS.poop;
        await img.decode().catch(() => {});
        if (S.cancelled) return;
        const H2 = W2 * ((img.naturalHeight || 313) / (img.naturalWidth || 527));

        const el = document.createElement('div');
        el.className = 'poop-dog';
        el.style.width = W2 + 'px';
        el.style.height = H2 + 'px';
        el.append(img);

        // комок лежить ПІД псом, щоб «виходити» з-за його задка
        const ballSize = Math.round(W2 * 0.3);
        const lump = document.createElement('button');
        lump.type = 'button';
        lump.className = 'lump';
        lump.setAttribute('aria-label', 'Розгорнути сторінку');
        lump.style.width = lump.style.height = ballSize + 'px';
        lump.style.visibility = 'hidden';
        const lumpCanvas = makeLump(ballSize);
        lump.append(lumpCanvas);
        lump.addEventListener('click', abort);

        layer.append(lump, el);
        S.poopEl = el;
        S.lumpEl = lump;
        S.lumpCanvas = lumpCanvas;

        const left = (vw - W2) / 2;
        const top = vh * 0.5 - H2 * 0.55;
        const place = (x, y, rot, sy) => {
            el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${rot}deg) scale(1, ${sy})`;
        };
        place(vw + 20, top, 0, 1);

        // 1) вбігає справа
        let t = 0;
        const fromX = vw + 20;
        await frameLoop(S, (dt) => {
            t += dt;
            const p = clamp(t / 0.7, 0, 1);
            place(fromX + (left - fromX) * easeOut(p), top + Math.abs(Math.sin(t * 16)) * -8 * (1 - p), 0, 1);
            return p >= 1;
        });
        if (S.cancelled) return;

        // 2) тужиться; наприкінці з'являється комок
        const STRAIN = 1.5;
        const ax = left + POOP_EXIT.x * W2;
        const ay = top + POOP_EXIT.y * H2;
        const setBall = (x, y, rot, sc) => {
            lump.style.transform = `translate3d(${x - ballSize / 2}px, ${y - ballSize / 2}px, 0) rotate(${rot}deg) scale(${sc})`;
        };
        strainSound(STRAIN);
        t = 0;
        await frameLoop(S, (dt) => {
            t += dt;
            const k = t / STRAIN;
            place(left + Math.sin(t * 58) * 2.5 * K2, top + Math.sin(t * 31) * 2 * K2 + k * 4, 0, 1 - 0.03 * (0.5 + 0.5 * Math.sin(t * 14)) * k);
            if (t > 0.7) {
                lump.style.visibility = 'visible';
                const e = clamp((t - 0.7) / (STRAIN - 0.7), 0, 1);
                setBall(ax + e * ballSize * 0.35, ay + e * ballSize * 0.2, e * 40, 0.15 + 0.85 * easeOut(e));
            }
            return t >= STRAIN;
        });
        if (S.cancelled) return;

        // 3) плюх: падає, відскакує і котиться
        plopSound();
        setTimeout(() => bark({ offset: 0.14, dur: 0.3, rate: 1.3, gain: 0.45 }), 220);
        const r = ballSize / 2;
        const ground = top + H2 * POOP_GROUND - r;
        let bx = ax + ballSize * 0.35;
        let by = ay + ballSize * 0.2;
        let vx = 90 * K2;
        let vy = 0;
        let rot = 40;
        let rest = 0;
        t = 0;
        await frameLoop(S, (dt) => {
            t += dt;
            place(left, top + (t < 0.25 ? 4 * (1 - t / 0.25) : 0), 0, 1);
            vy += 2600 * K2 * dt;
            by += vy * dt;
            bx += vx * dt;
            rot += (vx * dt * 180) / (Math.PI * r);
            if (by > ground) {
                by = ground;
                if (Math.abs(vy) > 160 * K2) plopSound(0.35);
                vy = -vy * 0.42;
                vx *= 0.72;
                if (Math.abs(vy) < 90 * K2) { vy = 0; rest += dt; }
            }
            setBall(bx, by, rot, 1);
            return rest > 0.25 && Math.abs(vx) < 6;
        });
        if (S.cancelled) return;

        // 4) чекаємо, поки клікнуть
        const hint = document.createElement('div');
        hint.className = 'lump-hint';
        hint.textContent = 'розгорнути';
        hint.style.left = bx + 'px';
        hint.style.top = by + r + 10 + 'px';
        layer.append(hint);
        S.hintEl = hint;
        hint.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, fill: 'forwards' });

        t = 0;
        await frameLoop(S, (dt) => {
            t += dt;
            setBall(bx, by, rot + Math.sin(t * 5) * 4, 1 + 0.035 * Math.sin(t * 6));
            return false;   // чекаємо на abort() — клік по комку, G або Esc
        });
    }

    async function start() {
        if (running) return;
        running = true;
        unlockAudio();

        const S = { cancelled: false, finishing: false, layer: null, scrollY0: window.scrollY };
        current = S;
        try {
            await sequence(S);
        } catch (err) {
            console.error('[dog]', err);
        }
        await finish(S);
        running = false;
        current = null;
    }

    function abort() {
        if (current && !current.finishing) current.cancelled = true;
    }

    async function sequence(S) {
        document.querySelectorAll('dialog[open]').forEach((d) => d.close());

        const DESK = cssVar('--desk', '#0e1a3a');
        const PAPER = cssVar('--paper', '#f5f7f2');
        const CRUMB_COLORS = [PAPER, '#c6d4ee', cssVar('--ink', '#1f3a93'), cssVar('--marker', '#ffe066'), '#ffffff'];

        const docEl = document.documentElement;
        const rects = collectContentRects();
        document.body.inert = true;   // поки сторінка «з'їдена», на невидимі кнопки не можна натиснути
        const docW = Math.max(docEl.scrollWidth, window.innerWidth);
        const docH = Math.max(docEl.scrollHeight, document.body.scrollHeight, window.innerHeight);

        /* ---- розміри пса і плану ---- */
        const W = Math.round(clamp(window.innerWidth * 0.22, 170, 280));
        const H = (W * 520) / 500;
        const K = W / 260;

        let R = 62 * K;
        let rowStep = 72 * K;
        let speed = 700 * K;
        let pts = planPath(rects, R, rowStep, docW, docH);
        let total = pathLength(pts);
        if (total / speed > MAX_EAT_SEC) {
            speed = total / MAX_EAT_SEC;
            R = Math.max(R, speed * CYCLE * 0.62);
            rowStep = R * 1.15;
            pts = planPath(rects, R, rowStep, docW, docH);
            total = pathLength(pts);
            speed = Math.max(700 * K, total / MAX_EAT_SEC);
        }

        const seg = [];   // накопичена довжина на початку кожного відрізка
        {
            let acc = 0;
            for (let i = 1; i < pts.length; i++) {
                seg.push(acc);
                acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
            }
        }
        function pointAt(dist) {
            if (pts.length < 2) return { x: pts[0].x, y: pts[0].y, dx: -1 };
            let i = seg.length - 1;
            while (i > 0 && seg[i] > dist) i--;
            const a = pts[i];
            const b = pts[i + 1];
            const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const t = clamp((dist - seg[i]) / len, 0, 1);
            return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: b.x - a.x, dy: b.y - a.y };
        }

        /* ---- шар з псом ---- */
        const layer = document.createElement('div');
        layer.id = 'dog-layer';
        layer.style.width = docW + 'px';
        layer.style.height = docH + 'px';

        const paper = document.createElement('div');       // canvas + заливка: зникають разом при поверненні
        paper.style.cssText = 'position:absolute;inset:0;';
        const cv = document.createElement('canvas');
        const scale = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2, 4096 / Math.max(docW, docH));
        cv.width = Math.ceil(docW * scale);
        cv.height = Math.ceil(docH * scale);
        const ctx = cv.getContext('2d');
        ctx.scale(scale, scale);
        const veil = document.createElement('div');
        veil.id = 'dog-veil';
        paper.append(cv, veil);

        const dogEl = document.createElement('div');
        dogEl.className = 'dog';
        dogEl.style.width = W + 'px';
        const inner = document.createElement('div');
        inner.className = 'dog-inner';
        const imgClosed = new Image();
        imgClosed.className = 'f-closed';
        imgClosed.alt = '';
        imgClosed.src = ASSETS.closed;
        const imgOpen = new Image();
        imgOpen.className = 'f-open';
        imgOpen.alt = '';
        imgOpen.src = ASSETS.open;
        inner.append(imgClosed, imgOpen);
        dogEl.append(inner);

        layer.append(paper, dogEl);
        docEl.appendChild(layer);
        S.layer = layer;
        S.paper = paper;
        S.veil = veil;
        S.dogEl = dogEl;
        S.W = W;
        S.docW = docW;
        await Promise.all([imgClosed.decode(), imgOpen.decode()]).catch(() => {});
        if (S.cancelled) return;

        /* ---- діри (канвас) ---- */
        const holes = document.createElement('canvas');     // об'єднання дір, потрібне лише для краю
        holes.width = cv.width;
        holes.height = cv.height;
        const hctx = holes.getContext('2d');
        hctx.scale(scale, scale);
        const tmp = document.createElement('canvas');

        function jag(cx, cy, r) {
            // край укусу: дуги від зубів (опуклі) зі зубчастими «стиками» всередину
            const n = 96;
            const marks = 6 + ((Math.random() * 3) | 0);
            const phase = Math.random() * Math.PI * 2;
            const wob = Math.random() * Math.PI * 2;
            const pts2 = [];
            for (let i = 0; i < n; i++) {
                const ang = (i / n) * Math.PI * 2;
                const tooth = 0.86 + 0.14 * Math.abs(Math.sin(ang * marks * 0.5 + phase));
                const blob = 1 + 0.07 * Math.sin(ang * 3 + wob);
                const rr = r * tooth * blob * rand(0.985, 1.02);
                pts2.push([cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr * 0.9]);
            }
            return pts2;
        }
        function fillPoly(c, poly, color) {
            c.beginPath();
            poly.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
            c.closePath();
            c.fillStyle = color;
            c.fill();
        }

        function bite(cx, cy, r) {
            const rimW = 5 * K + 2;
            const poly = jag(cx, cy, r);
            const k = (r + rimW) / r;
            const rim = poly.map((p) => [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k]);

            // 1) світла кромка паперу — лише там, де ще не було діри
            const pad = Math.ceil(r + rimW + 3);
            const size = pad * 2;
            const px = Math.max(1, Math.ceil(size * scale));
            tmp.width = px;
            tmp.height = px;
            const t = tmp.getContext('2d');
            const x0 = cx - pad;
            const y0 = cy - pad;
            t.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
            fillPoly(t, rim, '#ffffff');
            t.globalCompositeOperation = 'destination-out';
            t.setTransform(1, 0, 0, 1, 0, 0);
            t.drawImage(holes, x0 * scale, y0 * scale, px, px, 0, 0, px, px);
            t.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
            fillPoly(t, poly, '#000');
            ctx.drawImage(tmp, x0, y0, size, size);

            // 2) сама діра — видно стіл
            fillPoly(ctx, poly, DESK);
            fillPoly(hctx, poly, '#fff');
        }

        function crumbs(cx, cy, dirX) {
            for (let i = 0; i < 7; i++) {
                const el = document.createElement('i');
                el.className = 'crumb';
                const s = rand(4, 11) * K;
                el.style.width = s + 'px';
                el.style.height = s * rand(0.6, 1.3) + 'px';
                el.style.left = cx + 'px';
                el.style.top = cy + 'px';
                el.style.background = CRUMB_COLORS[(Math.random() * CRUMB_COLORS.length) | 0];
                layer.insertBefore(el, dogEl);
                const ang = (dirX < 0 ? Math.PI : 0) + rand(-1.1, 1.1) - 0.35;
                const dist = rand(40, 130) * K;
                const dx = Math.cos(ang) * dist;
                const dy = Math.sin(ang) * dist + rand(30, 80) * K;
                el.animate(
                    [
                        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
                        { transform: `translate(${dx}px,${dy}px) rotate(${rand(-300, 300)}deg)`, opacity: 0 },
                    ],
                    { duration: rand(450, 750), easing: 'cubic-bezier(.2,.7,.4,1)' }
                ).onfinish = () => el.remove();
            }
        }

        /* ---- стан пса ---- */
        const D = { x: 0, y: 0, flip: false, open: false, rot: 0, punch: 1, shakeX: 0 };
        S.D = D;
        function render() {
            dogEl.style.transform = `translate3d(${D.x + D.shakeX - MOUTH.x * W}px, ${D.y - MOUTH.y * H}px, 0)`;
            inner.style.transform = `scaleX(${D.flip ? -1 : 1}) rotate(${D.rot}deg) scale(${D.punch})`;
            dogEl.dataset.open = D.open ? '1' : '0';
        }

        const first = pts[0];
        D.x = docW + W * 0.9;
        D.y = first.y;
        render();
        window.scrollTo(0, clamp(first.y - window.innerHeight * 0.5, 0, Math.max(0, docH - window.innerHeight)));

        /* ---- 1. вбігає справа ---- */
        let t = 0;
        const fromX = D.x;
        await frameLoop(S, (dt) => {
            t += dt;
            const p = clamp(t / 0.5, 0, 1);
            D.x = fromX + (first.x - fromX) * easeOut(p);
            D.rot = Math.sin(t * 40) * 1.5;
            render();
            return p >= 1;
        });
        if (S.cancelled) return;

        /* ---- 2. гарчить ---- */
        bark();   // обидва гавкання підряд
        t = 0;
        await frameLoop(S, (dt) => {
            t += dt;
            D.open = Math.floor(t / 0.14) % 2 === 0 && t < 0.7;
            D.shakeX = Math.sin(t * 90) * 3 * K;
            D.rot += ((D.open ? 5 : -1) - D.rot) * Math.min(1, dt * 25);
            render();
            return t >= 0.8;
        });
        D.shakeX = 0;
        if (S.cancelled) return;

        /* ---- 3. ХАВ-ХАВ-ХАВ ---- */
        let dist = 0;
        let ct = 0;
        let wasOpen = true;
        let bites = 0;
        let lastBite = -1;
        let scrollTick = 0;

        await frameLoop(S, (dt) => {
            dist = Math.min(total, dist + speed * dt);
            const p = pointAt(dist);
            D.x = p.x;
            D.y = p.y;
            if (Math.abs(p.dx) > 1e-3 && Math.abs(p.dx) >= Math.abs(p.dy || 0) * 0.5) D.flip = p.dx > 0;

            ct += dt;
            const isOpen = (ct % CYCLE) < CYCLE * OPEN_FRAC;
            if (wasOpen && !isOpen) {
                const dir = D.flip ? 1 : -1;
                const rr = R * rand(0.86, 1.08);
                bite(D.x + dir * R * 0.12 + rand(-8, 8), D.y + rand(-8, 8), rr);
                crumbs(D.x, D.y, dir);
                if (bites % 2 === 0) chompBark(bites / 2);
                bites++;
                lastBite = ct;
            }
            wasOpen = isOpen;
            D.open = isOpen;

            D.punch = 1 + 0.07 * Math.max(0, 1 - (ct - lastBite) / 0.1);
            D.rot += ((isOpen ? 4 : -2) - D.rot) * Math.min(1, dt * 30);

            const maxScroll = docH - window.innerHeight;
            if (maxScroll > 0) {
                const want = clamp(D.y - window.innerHeight * 0.5, 0, maxScroll);
                scrollTick = window.scrollY + (want - window.scrollY) * Math.min(1, dt * 5);
                window.scrollTo(0, scrollTick);
            }
            render();
            return dist >= total;
        });
        if (S.cancelled) return;

        /* ---- 4. фінальний ХАВ: усе, що лишилося, зникає ---- */
        bark({ rate: 0.82, gain: 1 });
        D.open = true;
        D.rot = 5;
        render();
        veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, fill: 'forwards' });
        await wait(S, 0.9);
        if (S.cancelled) return;

        /* ---- 5. їдун тікає, прибігає інший пес і... ---- */
        await exitEater(S, 0);
        if (S.cancelled) return;
        await poopScene(S);
    }

    /** Повертає сторінку і прибирає псів (клік по комку, G, Esc). */
    async function finish(S) {
        S.finishing = true;
        const layer = S.layer;
        document.body.inert = false;
        if (!layer) return;

        S.cancelled = false;   // щоб frameLoop знову працював
        const vw = window.innerWidth;

        S.paper.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 650, easing: 'ease-out', fill: 'forwards' });
        window.scrollTo({ top: S.scrollY0, behavior: 'smooth' });   // повертаємо прокрутку, де була

        const jobs = [new Promise((r) => setTimeout(r, 700))];
        if (S.lumpCanvas) {
            // комок «розгортається» в сторінку
            S.lumpEl.style.pointerEvents = 'none';
            jobs.push(S.lumpCanvas.animate(
                [{ scale: 1, rotate: '0deg', opacity: 1 }, { scale: 10, rotate: '30deg', opacity: 0 }],
                { duration: 560, easing: 'ease-in', fill: 'forwards' }
            ).finished);
        }
        if (S.hintEl) S.hintEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
        if (S.poopEl) {
            jobs.push(S.poopEl.animate(
                [{ translate: '0 0' }, { translate: `${-vw}px 0` }],
                { duration: 650, easing: 'ease-in', fill: 'forwards' }
            ).finished);
        }
        if (!S.eaterGone) jobs.push(exitEater(S, 0.65));

        await Promise.all(jobs).catch(() => {});
        layer.remove();
    }

    /* ------------------------------------------------------------------
       Клавіатура: G (за фізичною клавішею — працює й в укр. розкладці)
       ------------------------------------------------------------------ */
    document.addEventListener('keydown', (e) => {
        if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        const el = e.target;
        if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;

        if (e.code === 'KeyG') {
            e.preventDefault();
            if (running) abort();   // під час сцени G повертає сторінку так само, як клік по комку
            else start();
        } else if (e.key === 'Escape' && running) {
            abort();
        }
    });

    window.__dog = { start, abort };   // для ручного виклику з консолі
})();
