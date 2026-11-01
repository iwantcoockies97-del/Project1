/* fun.js — дрібні жарти для сторінки нотаток.
 *
 * Нічого в існуючому коді не змінюється: скрипт лише «слухає» сторінку.
 *  1. Дзвінок у ТЦК: гудки, черга, «слухавку підняв Бобік», мигалки, пес з'являється з краю.
 *  2. Додав нотатку — конфеті, а нова нотатка «вистрибує».
 *  3. Клік по заголовку «Нотатки» — пес визирає і гавкає.
 *  4. Кнопка ТЦК двічі ухиляється від курсора (лише на ПК з мишкою).
 *  5. Коли пішов на іншу вкладку — вкладка кличе назад.
 */
(() => {
    'use strict';

    const A = {
        bark: '/static/audio/bark.mp3',
        closed: '/static/img/dog_closed.png',
        open: '/static/img/dog_open.png',
    };

    const rand = (a, b) => a + Math.random() * (b - a);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const cssVar = (n, f) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || f;

    [A.closed, A.open].forEach((src) => { new Image().src = src; });
    const barkData = fetch(A.bark).then((r) => r.arrayBuffer()).catch(() => null);

    /* ------------------------------------------------------------------
       Звук
       ------------------------------------------------------------------ */
    let actx = null;
    let abuf = null;
    let out = null;   // загальний вихід — його можна обірвати, коли діалог закрили

    function audio() {
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            if (!actx) actx = new AC();
            if (actx.state === 'suspended') actx.resume();
            if (!abuf) {
                barkData
                    .then((d) => (d ? actx.decodeAudioData(d.slice(0)) : null))
                    .then((b) => { abuf = b; })
                    .catch(() => {});
            }
        } catch (e) { /* без звуку теж працює */ }
    }

    function output() {
        if (!actx) return null;
        if (!out) {
            out = actx.createGain();
            out.gain.value = 1;
            out.connect(actx.destination);
        }
        return out;
    }

    function cutSound() {
        if (out) {
            try { out.gain.value = 0; out.disconnect(); } catch (e) { /* ignore */ }
            out = null;
        }
    }

    function tone(freq, at, dur, gain, type) {
        const o = output();
        if (!o) return;
        const t0 = actx.currentTime + at;
        const osc = actx.createOscillator();
        osc.type = type || 'sine';
        osc.frequency.value = freq;
        const g = actx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
        g.gain.setValueAtTime(gain, t0 + dur - 0.03);
        g.gain.linearRampToValueAtTime(0, t0 + dur);
        osc.connect(g);
        g.connect(o);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
    }

    /** Гудки: «ту-у-у … ту-у-у …» */
    function ringback(cycles) {
        for (let i = 0; i < cycles; i++) tone(425, i * 1.5, 0.9, 0.12);
    }

    /** Сирена «ві-ву». */
    function siren(sec) {
        const o = output();
        if (!o) return;
        const t0 = actx.currentTime;
        const osc = actx.createOscillator();
        osc.type = 'triangle';
        for (let t = 0; t < sec; t += 0.7) {
            osc.frequency.setValueAtTime(660, t0 + t);
            osc.frequency.linearRampToValueAtTime(920, t0 + t + 0.33);
            osc.frequency.setValueAtTime(920, t0 + t + 0.34);
            osc.frequency.linearRampToValueAtTime(660, t0 + t + 0.68);
        }
        const g = actx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.1, t0 + 0.1);
        g.gain.setValueAtTime(0.1, t0 + sec - 0.2);
        g.gain.linearRampToValueAtTime(0, t0 + sec);
        osc.connect(g);
        g.connect(o);
        osc.start(t0);
        osc.stop(t0 + sec + 0.05);
    }

    function bark(rate, gain) {
        const o = output();
        if (!o || !abuf) return;
        const offset = 0.14;
        const dur = 0.34;
        const r = rate || 1;
        const len = dur / r;
        const t0 = actx.currentTime;
        const src = actx.createBufferSource();
        src.buffer = abuf;
        src.playbackRate.value = r;
        const g = actx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(gain || 0.8, t0 + 0.008);
        g.gain.setValueAtTime(gain || 0.8, t0 + Math.max(0.008, len - 0.04));
        g.gain.linearRampToValueAtTime(0, t0 + len);
        src.connect(g);
        g.connect(o);
        src.start(t0, offset, dur);
    }

    /* ------------------------------------------------------------------
       Пес визирає з краю екрана
       ------------------------------------------------------------------ */
    let peeking = false;

    async function peek(barks) {
        if (peeking) return;
        peeking = true;
        audio();

        const el = document.createElement('div');
        el.className = 'fun-peek';
        el.setAttribute('popover', 'manual');   // шар поверх діалогу
        const img = new Image();
        img.alt = '';
        img.src = A.closed;
        el.append(img);
        document.body.append(el);
        try { el.showPopover && el.showPopover(); } catch (e) { /* без popover теж видно */ }

        const slide = (from, to, ms) => el.animate(
            [{ transform: `translateX(${from}%)` }, { transform: `translateX(${to}%)` }],
            { duration: ms, easing: 'cubic-bezier(.2,.9,.3,1.15)', fill: 'forwards' }
        ).finished;

        await slide(105, 42, 380).catch(() => {});
        for (let i = 0; i < (barks || 2); i++) {
            img.src = A.open;
            bark(rand(0.9, 1.15));
            await sleep(170);
            img.src = A.closed;
            await sleep(150);
        }
        await sleep(350);
        await slide(42, 105, 300).catch(() => {});
        try { el.hidePopover && el.hidePopover(); } catch (e) { /* ignore */ }
        el.remove();
        peeking = false;
    }

    /* ------------------------------------------------------------------
       1. Дзвінок у ТЦК
       ------------------------------------------------------------------ */
    const dlg = document.getElementById('tccDialog');
    let callToken = 0;

    function ensureStatus() {
        let status = dlg.querySelector('.tcc-status');
        let queue = dlg.querySelector('.tcc-queue');
        if (!status) {
            status = document.createElement('div');
            status.className = 'tcc-status';
            status.setAttribute('aria-live', 'polite');
            queue = document.createElement('div');
            queue.className = 'tcc-queue';
            const btns = dlg.querySelector('.dialog-btns');
            dlg.insertBefore(status, btns);
            dlg.insertBefore(queue, btns);
        }
        return { status, queue };
    }

    async function runCall() {
        const my = ++callToken;
        const alive = () => my === callToken && dlg.open;
        const { status, queue } = ensureStatus();
        status.textContent = '';
        queue.textContent = '';
        dlg.classList.remove('alarm');
        cutSound();
        audio();

        const say = async (text, speed) => {
            status.classList.add('typing');
            status.textContent = '';
            for (const ch of text) {
                if (!alive()) return false;
                status.textContent += ch;
                await sleep(speed || 28);
            }
            status.classList.remove('typing');
            return alive();
        };

        ringback(4);
        if (!(await say('Набираємо ТЦК…'))) return;
        await sleep(1700);
        if (!(await say('Гудки… ту-у-у… ту-у-у…'))) return;
        await sleep(1700);
        if (!(await say('Ваш дзвінок дуже важливий для нас.'))) return;
        await sleep(900);
        if (!alive()) return;

        // черга швидко біжить униз
        const start = 3000 + ((Math.random() * 6000) | 0);
        const steps = 36;
        for (let i = 0; i <= steps; i++) {
            if (!alive()) return;
            const left = Math.max(1, Math.round(start * Math.pow(1 - i / steps, 2.2)));
            queue.innerHTML = `Ви в черзі: №<b>${left}</b>`;
            await sleep(55);
        }
        queue.innerHTML = 'Ви в черзі: №<b>1</b> — очікуйте ще 3 роки.';
        await sleep(900);
        if (!(await say('Слухавку підняв Бобік.'))) return;
        await sleep(400);
        if (!alive()) return;

        // мигалки, сирена, пес
        dlg.classList.add('alarm');
        siren(2.8);
        peek(2);
        await sleep(450);
        if (!(await say('— Гав.', 60))) return;
        await sleep(2600);
        dlg.classList.remove('alarm');
        if (alive()) queue.textContent = 'Дзвінок завершено. Бобік не вважається військовозобов\'язаним.';
    }

    if (dlg) {
        let wasOpen = dlg.open;
        new MutationObserver(() => {
            if (dlg.open && !wasOpen) runCall();
            if (!dlg.open && wasOpen) {
                callToken++;
                cutSound();
                dlg.classList.remove('alarm');
            }
            wasOpen = dlg.open;
        }).observe(dlg, { attributes: true, attributeFilter: ['open'] });

        // перший жест користувача, щоб браузер дозволив звук
        document.addEventListener('click', (e) => {
            if (e.target.closest('[onclick*="callTcc"]')) audio();
        }, true);

        // «Набрати ще раз» запускає жарт спочатку
        dlg.addEventListener('click', (e) => {
            if (e.target.closest('a.btn-green')) { audio(); runCall(); }
        });
    }

    /* ------------------------------------------------------------------
       2. Конфеті після додавання нотатки
       ------------------------------------------------------------------ */
    function confetti(x, y, count) {
        const cv = document.createElement('canvas');
        cv.className = 'fun-confetti';
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        cv.width = window.innerWidth * dpr;
        cv.height = window.innerHeight * dpr;
        document.body.append(cv);
        const g = cv.getContext('2d');
        g.scale(dpr, dpr);

        const colors = [cssVar('--marker', '#ffe066'), cssVar('--ink', '#1f3a93'), '#ffffff', '#c6d4ee', cssVar('--red-pen', '#d7263d'), cssVar('--stamp', '#4b6b35')];
        const bits = Array.from({ length: count }, () => {
            const a = rand(-Math.PI * 0.95, -Math.PI * 0.05);
            const v = rand(260, 820);
            return {
                x, y,
                vx: Math.cos(a) * v,
                vy: Math.sin(a) * v,
                w: rand(6, 12),
                h: rand(4, 8),
                rot: rand(0, Math.PI * 2),
                vr: rand(-9, 9),
                c: colors[(Math.random() * colors.length) | 0],
            };
        });

        let last = performance.now();
        const t0 = last;
        const step = (now) => {
            const dt = Math.min(0.04, (now - last) / 1000);
            last = now;
            g.clearRect(0, 0, window.innerWidth, window.innerHeight);
            const life = (now - t0) / 1000;
            for (const b of bits) {
                b.vy += 1500 * dt;
                b.vx *= 1 - 1.4 * dt;
                b.vy *= 1 - 0.9 * dt;
                b.x += b.vx * dt;
                b.y += b.vy * dt;
                b.rot += b.vr * dt;
                g.save();
                g.globalAlpha = clampAlpha(life);
                g.translate(b.x, b.y);
                g.rotate(b.rot);
                g.fillStyle = b.c;
                g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
                g.restore();
            }
            if (life < 2.6) requestAnimationFrame(step);
            else cv.remove();
        };
        requestAnimationFrame(step);
    }
    const clampAlpha = (life) => Math.max(0, Math.min(1, (2.6 - life) / 0.8));

    const addBtn = document.querySelector('[onclick*="addNote"]');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const t = document.getElementById('title');
            if (t && t.value.trim()) {
                try { sessionStorage.setItem('fun:added', String(document.querySelectorAll('.note').length)); } catch (e) { /* ignore */ }
            }
        });
    }
    try {
        const prev = sessionStorage.getItem('fun:added');
        if (prev !== null) {
            sessionStorage.removeItem('fun:added');
            const notes = document.querySelectorAll('.note');
            if (notes.length > Number(prev)) {
                const fresh = notes[notes.length - 1];
                window.addEventListener('load', () => {
                    fresh.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    setTimeout(() => {
                        const r = fresh.getBoundingClientRect();
                        confetti(r.left + r.width / 2, Math.min(window.innerHeight - 40, Math.max(120, r.top + r.height / 2)), 140);
                        fresh.animate(
                            [{ scale: 0.88, opacity: 0.2 }, { scale: 1.05, opacity: 1, offset: 0.55 }, { scale: 1, opacity: 1 }],
                            { duration: 600, easing: 'cubic-bezier(.2,.9,.3,1.2)' }
                        );
                    }, 450);
                });
            }
        }
    } catch (e) { /* sessionStorage недоступний — просто без конфеті */ }

    /* ------------------------------------------------------------------
       3. Клік по заголовку — пес визирає
       ------------------------------------------------------------------ */
    const title = document.querySelector('.top h1');
    if (title) title.addEventListener('click', () => peek(1));

    /* ------------------------------------------------------------------
       4. Кнопка ТЦК двічі тікає від курсора
       ------------------------------------------------------------------ */
    const tccBtn = document.querySelector('.top .btn-green');
    if (tccBtn && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
        let dodges = 0;
        const lines = ['Не так швидко!', 'Ну добре, добре…'];
        tccBtn.addEventListener('pointerenter', () => {
            if (dodges >= 2 || dlg.open) return;
            const line = lines[dodges];
            dodges++;

            const bubble = document.createElement('div');
            bubble.className = 'fun-bubble';
            bubble.textContent = line;
            document.body.append(bubble);
            const r = tccBtn.getBoundingClientRect();
            bubble.style.left = Math.max(8, r.left - 40) + 'px';
            bubble.style.top = Math.max(8, r.top - 46) + 'px';
            bubble.animate([{ opacity: 0, translate: '0 8px' }, { opacity: 1, translate: '0 0' }], { duration: 160, fill: 'forwards' });
            setTimeout(() => bubble.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' }).finished.then(() => bubble.remove()), 1100);

            if (dodges === 1) {
                tccBtn.style.transition = 'translate 0.18s cubic-bezier(.3,1.6,.5,1)';
                tccBtn.style.translate = `${rand(-170, -90)}px ${rand(50, 110)}px`;
                setTimeout(() => { tccBtn.style.translate = '0 0'; }, 1300);
            } else {
                tccBtn.style.transition = 'translate 0.18s cubic-bezier(.3,1.6,.5,1)';
                tccBtn.style.translate = `${rand(-60, -20)}px ${rand(-50, -25)}px`;
                setTimeout(() => { tccBtn.style.translate = '0 0'; }, 900);
            }
        });
    }

    /* ------------------------------------------------------------------
       5. Назва вкладки, коли пішов на іншу
       ------------------------------------------------------------------ */
    const originalTitle = document.title;
    document.addEventListener('visibilitychange', () => {
        document.title = document.hidden ? 'Гав! Повернись 🐕' : originalTitle;
    });

    // для інших скриптів сторінки (нагадування)
    window.__fun = { confetti, peek, audio, bark };
})();
