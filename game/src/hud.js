// hud.js — everything on screen that is not the 3D view: health, ammo,
// money, timer, score, crosshair spread, hitmarker, killfeed, banners and
// the buy menu. It only reads state and writes DOM; it never simulates.
import { WEAPONS, GRENADE } from './weapons.js';

function $(id) { return document.getElementById(id); }

export function createHud() {
  const feed = [];
  return {
    show(id) { $(id).classList.remove('hidden'); },
    hide(id) { $(id).classList.add('hidden'); },
    isShown(id) { return !$(id).classList.contains('hidden'); },

    banner(text, sub = '') {
      const b = $('banner');
      b.textContent = text;
      $('subbanner').textContent = sub;
      b.style.opacity = '1';
      clearTimeout(this._bt);
      this._bt = setTimeout(() => { b.style.opacity = '0'; $('subbanner').textContent = ''; }, 2600);
    },
    hint(text) { $('hint').textContent = text; },
    killfeed(text) {
      feed.unshift(text);
      if (feed.length > 5) feed.pop();
      $('killfeed').innerHTML = feed.map((f) => `<div>${f}</div>`).join('');
    },
    clearFeed() { feed.length = 0; $('killfeed').innerHTML = ''; },

    hitmarker(kill) {
      const h = $('hitmarker');
      h.classList.toggle('kill', !!kill);
      h.style.opacity = '1';
      clearTimeout(this._ht);
      this._ht = setTimeout(() => { h.style.opacity = '0'; }, kill ? 220 : 120);
    },
    damageFlash() {
      const v = $('vignette');
      v.style.opacity = '0.9';
      setTimeout(() => { v.style.opacity = '0'; }, 140);
    },
    setCrosshair(spreadPx) {
      const g = Math.max(6, Math.min(46, spreadPx));
      $('armT').style.top = `${-8 - g}px`;
      $('armB').style.top = `${g}px`;
      $('armL').style.left = `${-8 - g}px`;
      $('armR').style.left = `${g}px`;
    },
    setPlant(progress, label) {
      if (progress === null) {
        this.hide('plantBar');
        this.hide('plantLabel');
        return;
      }
      this.show('plantBar');
      this.show('plantLabel');
      $('plantLabel').textContent = label;
      $('plantFill').style.width = `${Math.round(progress * 100)}%`;
    },

    // called every frame while playing
    update(ctx) {
      const { state, player, loadout } = ctx;
      const w = WEAPONS[loadout.current];
      const a = loadout.ammo[loadout.current];
      $('healthNum').textContent = Math.max(0, Math.ceil(player.health));
      $('healthNum').classList.toggle('low', player.health <= 30);
      $('healthFill').style.width = `${Math.max(0, player.health)}%`;
      $('healthFill').style.background = player.health <= 30 ? '#ff5544' : '#7fd08a';
      $('money').textContent = state.money.toLocaleString('en-US');
      $('weaponName').textContent = w.name;
      $('ammoNum').textContent = a ? `${a.mag} / ${a.reserve}` : '—';
      $('nadeCount').textContent = loadout.nades;
      $('scoreUs').textContent = state.scoreUs;
      $('scoreThem').textContent = state.scoreThem;
      $('roundNum').textContent = state.round;
      const t = Math.max(0, Math.ceil(state.bombPlanted ? state.bombTimer : state.roundTime));
      $('timer').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      $('timer').classList.toggle('low', t <= 15);
      const obj = $('objective');
      if (state.bombPlanted) {
        obj.textContent = `CHARGE PLANTED AT SITE ${state.bombSite} — DEFEND IT (${t}s)`;
      } else if (player.alive) {
        obj.textContent = 'Plant the charge at SITE A or SITE B — or eliminate FROST.';
      }
      // crosshair gap from spread + movement
      const spreadPx = 10 + (ctx.spreadNow ?? 0.012) * 900 + player.speed2d * 2.2;
      this.setCrosshair(spreadPx);
    },

    // buy menu: one card per weapon plus the grenade
    renderShop(loadout, money, onBuy) {
      const grid = $('shopGrid');
      grid.innerHTML = '';
      for (const w of Object.values(WEAPONS)) {
        const owned = !!loadout.owned[w.id];
        const afford = money >= w.price;
        const div = document.createElement('div');
        div.className = `shopItem${owned ? ' owned' : ''}${!owned && !afford ? ' cant' : ''}`;
        div.innerHTML = `<span class="pr">${owned ? 'OWNED' : '$' + w.price}</span>` +
          `<span class="nm">${w.name}</span> <span class="key">[${w.key}]</span>` +
          `<div class="ds">${w.desc}</div>`;
        if (!owned && afford) div.addEventListener('click', () => onBuy(w.id));
        grid.appendChild(div);
      }
      const g = document.createElement('div');
      const affordG = money >= GRENADE.price;
      g.className = `shopItem${!affordG ? ' cant' : ''}`;
      g.innerHTML = `<span class="pr">$${GRENADE.price}</span>` +
        `<span class="nm">${GRENADE.name}</span> <span class="key">[5]</span>` +
        `<div class="ds">Throw with G. ${GRENADE.damage} damage in a ${GRENADE.radius}m blast. Owned: ${loadout.nades}</div>`;
      if (affordG) g.addEventListener('click', () => onBuy('grenade'));
      grid.appendChild(g);
      $('buyMoney').textContent = `$${money.toLocaleString('en-US')}`;
    },
  };
}
