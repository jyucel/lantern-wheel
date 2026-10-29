// Lantern Wheel: application controller.
// Screens, HUD, tutorial, daily puzzle, hints, progress and audio around the
// game engine and the board renderer.

import { Game, starsFor, dockAction, cloneState } from './engine.js';
import { solve } from './solver.js';
import { LEVELS, CHAPTERS } from './levels.js';
import { DAILY } from './daily.js';
import { BoardView } from './render.js';
import { AudioEngine } from './audio.js';
import { Progress, dayKey } from './progress.js';
import { startSky } from './sky.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const PER_CHAPTER = 25;

const STAR_SVG = `<svg viewBox="0 0 24 24"><path d="M12 2.6l2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.3l-5.8 3.1 1.2-6.5L2.6 9.4l6.5-.8z" fill="#ffd27a" stroke="#fff1c9" stroke-width="1" stroke-linejoin="round"/></svg>`;
const LOCK_SVG = `<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
const SFX_ON = `<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const SFX_OFF = `<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="m16 9 5 6m0-6-5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const MUSIC_ON = `<svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="6.5" cy="18" r="2.5" fill="currentColor"/><circle cx="16.5" cy="16" r="2.5" fill="currentColor"/></svg>`;
const MUSIC_OFF = `<svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" opacity=".5"/><circle cx="6.5" cy="18" r="2.5" fill="currentColor" opacity=".5"/><path d="M3 3l18 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

const lantern = (x, y, c) => `<ellipse cx="${x}" cy="${y}" rx="9" ry="11" fill="${c}"/><rect x="${x - 5}" y="${y - 12}" width="10" height="3" rx="1" fill="#3a2a1c"/><rect x="${x - 5}" y="${y + 9}" width="10" height="3" rx="1" fill="#3a2a1c"/>`;
const INTROS = {
  pier: {
    title: 'Piers',
    text: 'A wooden pier is a queue. Lanterns leave from the end nearest the wheel, in the order they arrived, and new lanterns join at the far end. Plan the order you drop them in!',
    art: `<svg viewBox="0 0 160 110"><rect x="10" y="38" width="140" height="34" rx="11" fill="#3b2a22" stroke="#f4c46a" stroke-opacity=".5" stroke-width="2"/>${lantern(30, 55, '#ff6a5c')}${lantern(58, 55, '#43b8ff')}${lantern(86, 55, '#ff6a5c')}<path d="M118 55h22M118 55l7-6M118 55l7 6" stroke="#ffe0a0" stroke-width="3" fill="none" stroke-linecap="round"/><text x="10" y="96" fill="#d9c6c2" font-size="11" font-family="Fredoka, sans-serif">leaves first</text><text x="104" y="30" fill="#d9c6c2" font-size="11" font-family="Fredoka, sans-serif">joins here</text></svg>`,
  },
  oneway: {
    title: 'Clockwise only',
    text: 'Tonight the wheel turns one way only. Going back one gondola means going almost all the way around, so think before you spin.',
    art: `<svg viewBox="0 0 160 110"><circle cx="80" cy="55" r="40" fill="none" stroke="#f4c46a" stroke-opacity=".6" stroke-width="4"/><path d="M80 15a40 40 0 0 1 38 28" fill="none" stroke="#ffe0a0" stroke-width="4" stroke-linecap="round"/><path d="M118 43l2-12M118 43l-11-4" stroke="#ffe0a0" stroke-width="4" stroke-linecap="round"/>${lantern(80, 15, '#ffc23d')}${lantern(40, 55, '#3ed69a')}${lantern(80, 95, '#b48cff')}</svg>`,
  },
  gate: {
    title: 'Color gates',
    text: 'A dock with a colored frame is gated: it only accepts lanterns of its own color. Everything else must find another home.',
    art: `<svg viewBox="0 0 160 110"><rect x="20" y="38" width="120" height="34" rx="11" fill="#2b2546" stroke="#3ed69a" stroke-width="4"/><rect x="16" y="35" width="8" height="40" rx="3" fill="#3ed69a"/>${lantern(50, 55, '#3ed69a')}${lantern(78, 55, '#3ed69a')}<path d="M108 45l14 20M122 45l-14 20" stroke="#ff7a7a" stroke-width="4" stroke-linecap="round"/></svg>`,
  },
  tight: {
    title: 'Tight wheel',
    text: 'No spare dock this time, so every color needs its own home. Park lanterns on the wheel while you dig, but every gondola counts.',
    art: `<svg viewBox="0 0 160 110"><circle cx="80" cy="55" r="34" fill="none" stroke="#f4c46a" stroke-opacity=".6" stroke-width="4"/>${lantern(80, 21, '#ff6a5c')}${lantern(110, 72, '#43b8ff')}${lantern(50, 72, '#ffc23d')}</svg>`,
  },
};

class App {
  constructor() {
    this.progress = new Progress(safeStorage(), LEVELS.length);
    this.audio = new AudioEngine();
    this.audio.sfxOn = this.progress.setting('sfx');
    this.audio.musicOn = this.progress.setting('music');
    this.view = new BoardView($('#board'), {
      onAction: (ids, meta) => this.act(ids, meta),
      onInvalid: (kind) => this.invalid(kind),
    });
    this.view.setGlyphs(this.progress.setting('glyphs'));
    this.screen = 'title';
    this.mode = 'level';
    this.bindUi();
    this.refreshToggles();
    this.renderTitle();
    startSky($('#sky'));
    window.addEventListener('resize', () => this.onResize());
    this.openFromHash();
    window.addEventListener('hashchange', () => this.openFromHash());
  }

  openFromHash() {
    if (location.hash === '#daily') {
      if (this.mode !== 'daily' || this.screen !== 'game') this.openDaily();
      return;
    }
    const m = location.hash.match(/level=(\d+)/);
    if (!m) return;
    const id = Number(m[1]);
    if (id >= 1 && id <= LEVELS.length && this.progress.isUnlocked(id)) {
      if (this.mode !== 'level' || !this.level || this.level.id !== id || this.screen !== 'game') this.openLevel(id - 1);
    } else {
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  // ---- screens ----------------------------------------------------------------

  show(name) {
    this.screen = name;
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
    if (name === 'game') {
      this.view.start();
      requestAnimationFrame(() => this.onResize());
    } else {
      this.view.stop();
      this.hideHand();
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    }
    if (name === 'title') this.renderTitle();
    if (name === 'levels') this.renderLevels();
  }

  renderTitle() {
    const solved = this.progress.solvedCount();
    $('#play-level').textContent = solved ? `Level ${this.progress.continueLevel()}` : '';
    $('#title-stats').innerHTML = solved
      ? `<b>${solved}</b> / ${LEVELS.length} solved · <b>${this.progress.totalStars()}</b> ★`
      : `${LEVELS.length} puzzles · no ads · plays offline`;
    const streak = this.progress.dailyStreak();
    const done = this.progress.dailyDone();
    $('#daily-sub').textContent = done
      ? `Solved today ✓${streak ? ` · ${streak}-day streak` : ''}`
      : streak
        ? `Keep your ${streak}-day streak alive`
        : 'A fresh puzzle every day';
    $('#btn-daily').classList.toggle('done', done);
  }

  renderLevels() {
    const list = $('#levels-list');
    const current = this.progress.continueLevel();
    $('#levels-stars').textContent = `${this.progress.totalStars()} / ${LEVELS.length * 3} ★`;
    list.innerHTML = CHAPTERS.map((ch, c) => {
      const ids = LEVELS.filter((l) => l.chapter === c).map((l) => l.id);
      const stars = ids.reduce((a, id) => a + this.progress.stars(id), 0);
      const buttons = ids
        .map((id) => {
          const unlocked = this.progress.isUnlocked(id);
          const st = this.progress.stars(id);
          const cls = ['lvl', st ? 'solved' : '', unlocked ? '' : 'locked', id === current ? 'current' : ''].join(' ');
          const row = `<span class="s">${'★'.repeat(st)}<i>${'★'.repeat(3 - st)}</i></span>`;
          return `<button class="${cls}" data-level="${id}" ${unlocked ? '' : 'disabled aria-disabled="true"'} aria-label="Level ${id}${st ? `, ${st} stars` : ''}${unlocked ? '' : ', locked'}">${unlocked ? `${id}${row}` : LOCK_SVG}</button>`;
        })
        .join('');
      return `<section class="chapter"><div class="chapter-head"><span class="num">${c + 1}</span><h3>${ch.name}</h3><span class="cstars">${stars} / ${ids.length * 3} ★</span></div><p class="chapter-blurb">${ch.blurb}</p><div class="grid">${buttons}</div></section>`;
    }).join('');
    const cur = list.querySelector('.lvl.current');
    if (cur) requestAnimationFrame(() => (list.scrollTop = cur.offsetTop - list.offsetTop - list.clientHeight / 2));
  }

  // ---- level flow ----------------------------------------------------------------

  openLevel(index) {
    this.mode = 'level';
    this.levelIndex = index;
    const level = LEVELS[index];
    this.progress.setLast(level.id);
    $('#hud-level').textContent = `Level ${level.id}`;
    $('#hud-chapter').textContent = `${level.chapter + 1} · ${CHAPTERS[level.chapter].name}`;
    this.startBoard(level);
    history.replaceState(null, '', `#level=${level.id}`);
  }

  dailyLevel(day = dayKey()) {
    const days = Math.floor(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / 86_400_000);
    return DAILY[days % DAILY.length];
  }

  openDaily() {
    this.mode = 'daily';
    this.day = dayKey();
    $('#hud-level').textContent = 'Daily Lantern';
    $('#hud-chapter').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    this.startBoard(this.dailyLevel(this.day));
    history.replaceState(null, '', '#daily');
  }

  startBoard(level) {
    this.level = level;
    this.game = new Game(level);
    this.won = false;
    $('#hud-par').textContent = level.par;
    $('#hud-limit').textContent = level.limit;
    this.closeModal('#modal-win');
    this.closeModal('#modal-out');
    this.show('game');
    this.view.inputEnabled = true;
    this.view.setLevel(level, this.game);
    $('#btn-ccw').disabled = !!level.oneway;
    this.updateHud();
    this.setupTutorial();
    const present = {
      pier: level.docks.some((d) => d.kind === 'pier'),
      oneway: !!level.oneway,
      gate: level.docks.some((d) => d.gate !== undefined),
      tight: this.mode === 'level' && CHAPTERS[level.chapter].intro === 'tight',
    };
    const intro = Object.keys(present).find((k) => present[k] && !this.progress.hasSeen(k));
    if (intro) this.showIntro(intro);
  }

  act(ids, meta = {}) {
    if (!this.game || this.won) return false;
    const before = this.game.state;
    if (!this.game.play(ids)) {
      if (this.game.moveCount + ids.length > this.game.limit) {
        this.audio.invalid();
        this.toast(this.game.movesLeft ? `Only ${this.game.movesLeft} move${this.game.movesLeft === 1 ? '' : 's'} left` : 'Out of moves. Undo or restart.');
      } else if (ids.length === 1 && ids[0][0] === 'd') {
        this.explainDock(Number(ids[0].slice(1)), before);
      } else if (ids[0] === 'ccw') this.invalid('oneway');
      return false;
    }
    this.view.animate(ids, before);
    if (ids[0] === 'cw' || ids[0] === 'ccw') ids.forEach((_, i) => setTimeout(() => this.audio.spin(0, i), meta.drag ? i * 25 : i * 60));
    else {
      const unloaded = this.game.state.wheel[this.level.docks[Number(ids[0].slice(1))].at] === -1;
      if (unloaded) this.audio.swap();
      else this.audio.undo();
    }
    this.level.docks.forEach((_, i) => {
      const was = this.dockDoneIn(before, i);
      if (!was && this.view.dockDone(i) && !this.game.solved) {
        this.audio.ringDone(i);
        this.view.burst(i);
      }
    });
    this.view.showHint(null);
    this.updateHud(true);
    if (this.game.solved) this.onWin();
    else {
      this.updateTutorial();
      if (this.game.outOfMoves) {
        clearTimeout(this.outTimer);
        this.outTimer = setTimeout(() => {
          if (this.game.outOfMoves && this.screen === 'game') this.openModal('#modal-out');
        }, 450);
      }
    }
    return true;
  }

  dockDoneIn(state, i) {
    const d = state.docks[i];
    if (!d.length || !d.every((c) => c === d[0])) return false;
    let total = 0;
    for (const c of state.wheel) if (c === d[0]) total++;
    for (const dd of state.docks) for (const c of dd) if (c === d[0]) total++;
    return total === d.length;
  }

  explainDock(i, state) {
    const a = dockAction(this.level, state, i);
    this.view.shake(i);
    this.audio.invalid();
    const msg = { full: 'That dock is full', gate: 'This gate only takes its own color', empty: 'Nothing to lift here: the dock and its gondola are empty' }[a.reason];
    if (msg) this.toast(msg);
  }

  spin(dir) {
    if (this.screen !== 'game' || this.modal) return;
    this.view.spin(dir);
  }

  undo() {
    if (!this.game || this.won) return;
    this.closeModal('#modal-out');
    const after = cloneState(this.game.state);
    const last = this.game.undo();
    if (!last) return this.toast('Nothing to undo');
    this.view.animate(last.ids, after, { reverse: true });
    this.audio.undo();
    this.updateHud();
    this.updateTutorial();
  }

  restart() {
    if (!this.game || this.won) return;
    this.closeModal('#modal-out');
    if (!this.game.history.length) return;
    this.game.restart();
    this.view.resetAnimation();
    this.audio.undo();
    this.updateHud();
    this.updateTutorial();
  }

  hint() {
    if (!this.game || this.won) return;
    const free = this.mode === 'level' && this.level.id <= 3;
    if (!free && this.progress.hints <= 0) {
      this.toast('No hints left. Earn one with each new ★★★ or daily puzzle.');
      this.audio.invalid();
      return;
    }
    const res = solve(this.level, this.game.state, { maxNodes: 250_000 });
    if (!res || !res.path.length) {
      this.toast('Too tangled for a hint. Try Undo or Restart.');
      return;
    }
    if (res.length > this.game.movesLeft) {
      this.toast(`Can’t finish within the limit from here (${res.length} needed). Undo or restart.`);
      return;
    }
    if (!free) this.progress.useHint();
    this.view.showHint(res.path[0]);
    this.toast(`${res.length} move${res.length === 1 ? '' : 's'} from here at best`);
    this.audio.click();
    this.updateHud();
  }

  invalid(kind) {
    this.audio.invalid();
    if (navigator.vibrate) navigator.vibrate(30);
    if (kind === 'oneway') this.toast('Tonight the wheel only turns clockwise');
  }

  onWin() {
    this.won = true;
    this.view.inputEnabled = false;
    this.hideHand();
    if (this.tutorial) $('#coach').innerHTML = 'Lovely! Every dock glows in <b>one color</b>.';
    this.view.celebrate();
    this.audio.win();
    const moves = this.game.moveCount;
    const res =
      this.mode === 'daily'
        ? this.progress.recordDaily(this.day, moves, this.level.par, this.level.limit)
        : this.progress.recordWin(this.level.id, moves, this.level.par, this.level.limit);
    clearTimeout(this.winTimer);
    this.winTimer = setTimeout(() => this.showWin(moves, res), 1100);
  }

  showWin(moves, res) {
    const par = this.level.par;
    const daily = this.mode === 'daily';
    const last = !daily && this.levelIndex === LEVELS.length - 1;
    const chapterEnd = !daily && (this.levelIndex + 1) % PER_CHAPTER === 0;
    $('#win-stars').innerHTML = [0, 1, 2].map(() => STAR_SVG).join('');
    $$('#win-stars svg').forEach((s, i) => {
      s.style.animationDelay = `${0.15 + i * 0.18}s`;
      s.classList.add(i < res.stars ? 'on' : 'off');
    });
    const titles = ['Sorted!', 'Sorted!', 'Nicely done!', 'Perfect festival!'];
    $('#win-title').textContent = daily
      ? 'Daily Lantern solved!'
      : last
        ? 'The Grand Festival glows!'
        : chapterEnd
          ? `${CHAPTERS[this.level.chapter].name} complete!`
          : titles[res.stars];
    $('#win-detail').innerHTML =
      `<b>${moves}</b> move${moves === 1 ? '' : 's'} · par <b>${par}</b>` +
      (res.stars < 3 ? `<br>Solve it in ${par} for three stars.` : moves < par ? '<br>Under par?! Remarkable.' : '');
    const notes = [];
    if (daily) notes.push(`🔥 ${res.streak}-day streak`);
    if (!daily && res.prevBest !== null && res.newBest) notes.push(`New best! (was ${res.prevBest})`);
    if (res.hintEarned || (daily && res.first)) notes.push('+1 hint');
    if (last) notes.push(`You solved all ${LEVELS.length} puzzles. Thank you for playing!`);
    $('#win-best').textContent = notes.join(' · ');
    $('#win-next').hidden = last || daily;
    $('#win-replay').hidden = daily;
    this.openModal('#modal-win');
    setTimeout(() => (last || daily ? $('#win-levels') : $('#win-next')).focus(), 50);
  }

  next() {
    if (this.mode === 'level' && this.levelIndex < LEVELS.length - 1) this.openLevel(this.levelIndex + 1);
  }

  updateHud(bump = false) {
    const g = this.game;
    const el = $('#hud-moves');
    el.textContent = g.moveCount;
    if (bump) {
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
    $('.hud-moves').classList.toggle('low', g.movesLeft <= 2);
    const st = starsFor(g.moveCount, this.level.par, this.level.limit);
    $('#hud-stars').innerHTML = `${'★'.repeat(st)}<i>${'★'.repeat(3 - st)}</i>`;
    $('#btn-undo').disabled = !g.history.length;
    $('#btn-restart').disabled = !g.history.length;
    const free = this.mode === 'level' && this.level.id <= 3;
    $('#hint-count').textContent = free ? '∞' : this.progress.hints;
  }

  // ---- tutorial --------------------------------------------------------------------

  setupTutorial() {
    this.tutorial = this.mode === 'level' && this.level.id <= 3 ? this.level.id : 0;
    this.updateTutorial();
  }

  updateTutorial() {
    const coach = $('#coach');
    if (!this.tutorial || this.won) {
      if (!coach.hidden && !this.won) {
        coach.hidden = true;
        this.view.layout();
      }
      this.hideHand();
      return;
    }
    const sol = solve(this.level, this.game.state, { maxNodes: 20_000 });
    const next = sol && sol.path[0];
    let text;
    if (this.tutorial === 1) {
      text = 'Every dock must hold <b>one color</b>. <b>Tap the dock</b> facing the red lantern to drop it there.';
    } else if (this.tutorial === 2) {
      text =
        next === 'cw' || next === 'ccw'
          ? '<b>Spin the wheel</b> (drag it, or use the spin buttons) until the yellow lantern faces the empty dock.'
          : 'Now <b>tap that dock</b> to drop the lantern.';
    } else {
      const top = this.game.state.docks[0];
      text =
        top.length === 3
          ? 'Towers are stacks: only the lantern <b>nearest the wheel</b> can leave. Tap that dock to <b>lift</b> the yellow one off the top.'
          : 'Bring it to the dock with yellow lanterns, then tap. Moves are limited: match <b>par</b> for three stars.';
    }
    coach.innerHTML = text;
    if (coach.hidden) {
      coach.hidden = false;
      this.view.layout();
    }
    if (next) {
      this.view.showHint(next, true);
      if (next[0] === 'd') {
        this.handTarget = next;
        this.placeHand();
      } else this.hideHand();
    } else this.hideHand();
  }

  placeHand() {
    if (!this.handTarget || this.screen !== 'game') return;
    const p = this.view.clientPointFor(this.handTarget);
    const hand = $('#hand');
    hand.style.left = `${p.x}px`;
    hand.style.top = `${p.y}px`;
    hand.hidden = false;
  }

  hideHand() {
    this.handTarget = null;
    $('#hand').hidden = true;
  }

  // ---- modals & misc -------------------------------------------------------------------

  showIntro(key) {
    $('#intro-title').textContent = INTROS[key].title;
    $('#intro-text').textContent = INTROS[key].text;
    $('#intro-art').innerHTML = INTROS[key].art;
    this.introKey = key;
    this.openModal('#modal-intro');
  }

  openModal(sel) {
    $(sel).hidden = false;
    this.modal = sel;
  }

  closeModal(sel) {
    $(sel).hidden = true;
    if (this.modal === sel) this.modal = null;
  }

  toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 1900);
  }

  refreshToggles() {
    for (const [key, on, off] of [
      ['sfx', SFX_ON, SFX_OFF],
      ['music', MUSIC_ON, MUSIC_OFF],
    ]) {
      $$(`[data-toggle="${key}"]`).forEach((b) => {
        const v = this.progress.setting(key);
        b.innerHTML = v ? on : off;
        b.classList.toggle('off', !v);
        b.setAttribute('aria-pressed', String(v));
      });
    }
    $('#set-sfx').checked = this.progress.setting('sfx');
    $('#set-music').checked = this.progress.setting('music');
    $('#set-glyphs').checked = this.progress.setting('glyphs');
  }

  setSfx(on) {
    this.progress.setSetting('sfx', on);
    this.audio.setSfx(on);
    this.refreshToggles();
  }

  setMusic(on) {
    this.progress.setSetting('music', on);
    this.audio.setMusic(on);
    this.refreshToggles();
  }

  onResize() {
    if (this.screen !== 'game') return;
    this.view.layout();
    if (this.handTarget) this.placeHand();
  }

  bindUi() {
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });

    $('#btn-play').addEventListener('click', () => this.openLevel(this.progress.continueLevel() - 1));
    $('#btn-daily').addEventListener('click', () => this.openDaily());
    $('#btn-levels').addEventListener('click', () => this.show('levels'));
    $('#btn-help').addEventListener('click', () => this.openModal('#modal-help'));
    $('#btn-settings').addEventListener('click', () => this.openModal('#modal-settings'));
    $$('[data-nav="title"]').forEach((b) => b.addEventListener('click', () => this.show('title')));
    $('#btn-back').addEventListener('click', () => this.show(this.mode === 'daily' ? 'title' : 'levels'));
    $('#levels-list').addEventListener('click', (e) => {
      const b = e.target.closest('.lvl');
      if (!b || b.disabled) return;
      this.audio.click();
      this.openLevel(Number(b.dataset.level) - 1);
    });
    $('#btn-undo').addEventListener('click', () => this.undo());
    $('#btn-restart').addEventListener('click', () => this.restart());
    $('#btn-hint').addEventListener('click', () => this.hint());
    $('#btn-cw').addEventListener('click', () => this.spin(1));
    $('#btn-ccw').addEventListener('click', () => this.spin(-1));
    $('#out-undo').addEventListener('click', () => this.undo());
    $('#out-restart').addEventListener('click', () => this.restart());
    $('#win-next').addEventListener('click', () => this.next());
    $('#win-replay').addEventListener('click', () => this.openLevel(this.levelIndex));
    $('#win-levels').addEventListener('click', () => {
      this.closeModal('#modal-win');
      this.show(this.mode === 'daily' ? 'title' : 'levels');
    });
    $('#intro-ok').addEventListener('click', () => {
      this.progress.markSeen(this.introKey);
      this.closeModal('#modal-intro');
    });
    $$('[data-close]').forEach((b) => b.addEventListener('click', () => this.closeModal(`#${b.closest('.modal').id}`)));
    $$('[data-toggle="sfx"]').forEach((b) => b.addEventListener('click', () => this.setSfx(!this.progress.setting('sfx'))));
    $$('[data-toggle="music"]').forEach((b) => b.addEventListener('click', () => this.setMusic(!this.progress.setting('music'))));
    $('#set-sfx').addEventListener('change', (e) => this.setSfx(e.target.checked));
    $('#set-music').addEventListener('change', (e) => this.setMusic(e.target.checked));
    $('#set-glyphs').addEventListener('change', (e) => {
      this.progress.setSetting('glyphs', e.target.checked);
      this.view.setGlyphs(e.target.checked);
    });
    $('#btn-reset').addEventListener('click', () => {
      if (!confirm('Reset all progress and stars?')) return;
      this.progress.reset();
      this.renderTitle();
      this.toast('Progress reset');
    });

    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') {
        if (this.modal && this.modal !== '#modal-win' && this.modal !== '#modal-out') return this.closeModal(this.modal);
        if (this.screen === 'game') return this.show(this.mode === 'daily' ? 'title' : 'levels');
        if (this.screen === 'levels') return this.show('title');
        return;
      }
      if (this.modal === '#modal-out' && (k === 'z' || k === 'r' || k === 'backspace')) this.closeModal('#modal-out');
      if (this.screen !== 'game' || this.modal) return;
      if (k === 'z' || k === 'backspace') this.undo();
      else if (k === 'r') this.restart();
      else if (k === 'h') this.hint();
      else if (e.key === 'ArrowRight') this.spin(1);
      else if (e.key === 'ArrowLeft') this.spin(-1);
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= this.level.docks.length) this.act([`d${Number(e.key) - 1}`]);
    });
  }
}

function safeStorage() {
  try {
    const s = window.localStorage;
    s.setItem('__lw', '1');
    s.removeItem('__lw');
    return s;
  } catch {
    return null;
  }
}

window.__wheel = new App();
