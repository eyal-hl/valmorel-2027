(function () {
  'use strict';

  const trip = window.TRIP;
  const { resort } = trip;
  const view = document.getElementById('view');

  // ?now=2027-01-26T10:00 previews the app as of another moment.
  const nowParam = new URLSearchParams(location.search).get('now');
  const now = () => (nowParam ? new Date(nowParam) : new Date());

  /* ---------- small helpers ---------- */
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const pad = (n) => String(n).padStart(2, '0');
  const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => localDate(now());
  const toUTC = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const dayDiff = (from, to) => Math.round((toUTC(to) - toUTC(from)) / 86400000);
  const fmtDate = (ymd, opts) => new Date(toUTC(ymd)).toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts });
  const longDate = (ymd) => fmtDate(ymd, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const dayDate = (ymd) => fmtDate(ymd, { weekday: 'long', day: 'numeric', month: 'long' });
  const shortDate = (ymd) => fmtDate(ymd, { day: 'numeric', month: 'short' });
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const startDate = trip.start.slice(0, 10);
  const endDate = trip.end.slice(0, 10);
  const totalDays = dayDiff(startDate, endDate) + 1;

  const storeKey = (key) => `carnet:${key}`;
  const load = (key, fallback) => {
    try { const raw = localStorage.getItem(storeKey(key)); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  };
  const save = (key, value) => { try { localStorage.setItem(storeKey(key), JSON.stringify(value)); } catch (e) { /* storage full or blocked */ } };
  const toggled = (list, value, on) => (on ? [...list.filter((v) => v !== value), value] : list.filter((v) => v !== value));

  const mapsUrl = (query) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  const TYPE_LABEL = { flight: 'Flight', train: 'Train', car: 'Transfer', hotel: 'Stay', ski: 'Ski', sight: 'Explore', food: 'Eat', note: 'Note' };
  const STATUS_LABEL = { booked: 'Booked', todo: 'To sort', idea: 'Idea' };
  const WHEN_AT = { Morning: '09:00', Lunch: '12:30', Afternoon: '13:30', Evening: '18:30' };

  /* ---------- trip state ---------- */
  function phase() {
    if (now() < new Date(trip.start)) return 'before';
    return today() <= endDate ? 'during' : 'after';
  }

  const itemMoment = (day, item) => new Date(`${day.date}T${item.at || WHEN_AT[item.when] || '12:00'}:00`);

  function nextItem() {
    const t = now();
    for (const day of trip.days) {
      for (const item of day.items) {
        if (itemMoment(day, item) > t) return { day, item };
      }
    }
    return null;
  }

  /* ---------- navigation ---------- */
  const TABS = [['home', 'Home'], ['plan', 'Plan'], ['included', 'Included'], ['map', 'Map'], ['explore', 'Explore'], ['kit', 'Kit']];
  const currentTab = () => { const id = location.hash.slice(1); return TABS.some(([t]) => t === id) ? id : 'home'; };

  let map = null;
  let ticker = null;

  function route() {
    if (ticker) { clearInterval(ticker); ticker = null; }
    if (map) { map.remove(); map = null; }
    const tab = currentTab();
    document.getElementById('nav').innerHTML = TABS
      .map(([id, label]) => `<a href="#${id}" ${id === tab ? 'aria-current="page"' : ''}>${label}</a>`)
      .join('');
    ({ home: renderHome, plan: renderPlan, included: renderIncluded, map: renderMap, explore: renderExplore, kit: renderKit })[tab]();
    window.scrollTo(0, 0);
  }

  /* ---------- home ---------- */
  const RIDGE = `<svg class="ridge" viewBox="0 0 800 150" preserveAspectRatio="none" aria-hidden="true">
    <path class="ridge-far" d="M0 150V92l74-40 62 30 92-66 70 48 58-26 96 62 74-44 88 50 72-36 114 60v20z"/>
    <path class="ridge-snow" d="M228 16l-33 24 21-4 13 12 12-11 19 7zM508 66l-31 18 18-2 12 9 12-8 18 4zM74 52l-30 16 18-2 11 8 11-8 19 4z"/>
    <path class="ridge-mid" d="M0 150v-30l110-34 88 28 124-52 96 48 110-32 126 42 146-36v66z"/>
    <path class="ridge-front" d="M0 150v-14l180-22 170 16 200-24 250 28v16z"/>
  </svg>`;

  function snowHtml() {
    const flakes = Array.from({ length: 26 }, (_, i) => {
      const left = (i * 37) % 100;
      const size = 2 + (i % 3);
      const dur = 7 + (i * 13) % 9;
      const delay = -((i * 7) % 12);
      return `<i style="left:${left}%;width:${size}px;height:${size}px;animation-duration:${dur}s;animation-delay:${delay}s"></i>`;
    }).join('');
    return `<div class="snow" aria-hidden="true">${flakes}</div>`;
  }

  function heroHtml() {
    const p = phase();
    let body;
    if (p === 'before') {
      const days = dayDiff(today(), startDate);
      body = `<p class="eyebrow">${esc(trip.title)}</p>
        <div class="count">
          ${days > 0
            ? `<span class="count-num">${days}</span><span class="count-unit">${days === 1 ? 'day' : 'days'} to go</span>`
            : '<span class="count-num count-today">Today</span>'}
        </div>
        <div class="clock" id="clock" role="timer" aria-label="Time until check-in"></div>
        <p class="hero-sub">${esc(longDate(startDate))} to ${esc(shortDate(endDate))}. ${esc(plural(resort.nights, 'night'))} at ${esc(resort.name)}.</p>`;
    } else if (p === 'during') {
      const dayNum = dayDiff(startDate, today()) + 1;
      const left = totalDays - dayNum;
      body = `<p class="eyebrow">${esc(dayDate(today()))}</p>
        <div class="count"><span class="count-unit lead">Day</span><span class="count-num">${dayNum}</span><span class="count-unit">of ${totalDays}</span></div>
        <p class="hero-sub">${left > 0 ? `${esc(plural(left, 'day'))} left in the Alps.` : 'Last day. Safe travels home.'}</p>`;
    } else {
      const seen = load('visited', []).length;
      body = `<p class="eyebrow">${esc(trip.title)}</p>
        <h1 class="hero-title">Bon retour</h1>
        <p class="hero-sub">Trip complete${seen ? `, with ${esc(plural(seen, 'place'))} ticked off` : ''}. Time to start planning the next one.</p>`;
    }
    return `<section class="hero">${snowHtml()}<div class="hero-body">${body}</div>${RIDGE}</section>`;
  }

  function nextUpHtml() {
    const next = nextItem();
    if (!next) return '';
    const { day, item } = next;
    return `<section class="ticket" aria-label="Next up">
      <div class="ticket-main">
        <p class="eyebrow">Next up <span class="badge status-${esc(item.status)}">${esc(STATUS_LABEL[item.status])}</span></p>
        <h2>${esc(item.title)}</h2>
        <p class="muted">${esc(item.detail || '')}</p>
      </div>
      <div class="ticket-stub">
        <strong>${esc(shortDate(day.date))}</strong>
        <span>${esc(fmtDate(day.date, { weekday: 'long' }))}</span>
        <span>${esc(item.when || '')}</span>
      </div>
    </section>`;
  }

  function todayHtml() {
    if (phase() !== 'during') return '';
    const day = trip.days.find((d) => d.date === today());
    return day ? `<section><h2 class="section-title">Today: ${esc(day.title)}</h2>${timelineHtml(day)}</section>` : '';
  }

  function todosHtml() {
    if (phase() === 'after') return '';
    const done = load('todos', []);
    const count = trip.todos.filter((t) => done.includes(t.id)).length;
    return `<section>
      <h2 class="section-title">Still to sort <span class="muted small" id="todo-count">${count} of ${trip.todos.length} done</span></h2>
      <div class="todos">
        ${trip.todos.map((t) => `<label class="check todo">
          <input type="checkbox" data-action="toggle-todo" data-id="${esc(t.id)}" ${done.includes(t.id) ? 'checked' : ''}>
          <span><strong>${esc(t.title)}</strong><small class="muted">${esc(t.detail)}${t.url ? ` <a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.urlLabel)}</a>` : ''}</small></span>
        </label>`).join('')}
      </div>
    </section>`;
  }

  function stayHtml() {
    return `<section>
      <h2 class="section-title">Where you're staying</h2>
      <div class="stay-main">
        <h3>${esc(resort.name)}</h3>
        <p class="muted">${esc(resort.region)} · ${esc(plural(resort.guests, 'guest'))} · ${esc(plural(resort.nights, 'night'))}</p>
        <p>${esc(resort.blurb)}</p>
        <p class="muted">${esc(resort.address)}</p>
        <div class="card-actions">
          <a class="chip" href="#included">What's included</a>
          <a class="chip" href="${esc(mapsUrl(resort.name))}" target="_blank" rel="noopener">Open in Maps</a>
          <a class="chip" href="${esc(resort.site)}" target="_blank" rel="noopener">Club Med page</a>
        </div>
      </div>
    </section>`;
  }

  /* ---------- included ---------- */
  function renderIncluded() {
    const payRows = (rows) => `<ul class="pay-list">${rows.map((r) => `<li>
      <strong>${esc(r.title)}</strong>
      <span class="muted">${esc(r.detail)}</span>
    </li>`).join('')}</ul>`;

    const { lessons } = trip;
    const levelRows = (rows) => `<dl class="levels">${rows.map(([level, what]) => `<div><dt>${esc(level)}</dt><dd>${esc(what)}</dd></div>`).join('')}</dl>`;

    view.innerHTML = `<h1 class="page-title">What's included</h1>
      <p class="muted lede">From Club Med's public pages, not your own contract. Your voucher is the final word.</p>
      <button class="btn btn-quiet" data-action="jump-lessons">How group lessons work</button>

      <section>
        <h2 class="section-title">Already paid for</h2>
        <div class="inc-groups">
          ${trip.included.map((group) => `<article class="inc-group">
            <h3>${esc(group.title)}</h3>
            <ul class="inc-list">${group.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
          </article>`).join('')}
        </div>
      </section>

      <section id="lessons" class="lessons">
        <h2 class="section-title">How group lessons work</h2>
        <p>${esc(lessons.summary)}</p>
        <ol class="steps">
          ${lessons.steps.map((s) => `<li><strong>${esc(s.title)}</strong><span class="muted">${esc(s.detail)}</span></li>`).join('')}
        </ol>

        <h3 class="sub-title">A typical day</h3>
        <dl class="levels day-times">${lessons.day.map(([time, what]) => `<div><dt>${esc(time)}</dt><dd>${esc(what)}</dd></div>`).join('')}</dl>
        <p class="muted small">${esc(lessons.dayNote)}</p>

        <h3 class="sub-title">Which level are you?</h3>
        <div class="level-cols">
          <div><h4>Ski</h4>${levelRows(lessons.ski)}</div>
          <div><h4>Snowboard</h4>${levelRows(lessons.board)}</div>
        </div>

        <h3 class="sub-title">Ask when you sign up</h3>
        <ul class="ask-list">${lessons.ask.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>
      </section>

      <section>
        <h2 class="section-title">Pay extra at the resort</h2>
        <p class="muted lede">Club Med doesn't publish prices or name every paid activity online, so ask at the resort for the full list and current prices.</p>
        ${payRows(trip.paid)}
      </section>

      <section>
        <h2 class="section-title">Outside Club Med</h2>
        ${payRows(trip.outside)}
      </section>

      <section>
        <h2 class="section-title">Only with a suite</h2>
        <p class="muted lede">Club Med's suite perks are not part of a standard room. Your emails don't show your room type, so check your voucher.</p>
        <ul class="inc-list suite-list">${trip.suite.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
      </section>`;
  }

  function renderHome() {
    view.innerHTML = `${heroHtml()}${nextUpHtml()}${todayHtml()}
      <section>
        <h2 class="section-title">Valmorel right now</h2>
        <div id="weather"><p class="muted">Loading the forecast…</p></div>
      </section>
      ${todosHtml()}${stayHtml()}`;
    if (phase() === 'before') startClock();
    loadWeather();
  }

  function startClock() {
    const target = new Date(trip.start).getTime();
    const el = document.getElementById('clock');
    const tick = () => {
      const left = target - now().getTime();
      if (left <= 0) { route(); return; }
      el.textContent = `Check-in in ${Math.floor(left / 86400000)}d ${pad(Math.floor(left / 3600000) % 24)}h ${pad(Math.floor(left / 60000) % 60)}m ${pad(Math.floor(left / 1000) % 60)}s`;
    };
    tick();
    if (!nowParam) ticker = setInterval(tick, 1000);
  }

  /* ---------- weather ---------- */
  const wmoLabel = (code) => {
    if (code === 0) return 'Clear';
    if (code <= 2) return 'Partly cloudy';
    if (code === 3) return 'Overcast';
    if (code <= 48) return 'Fog';
    if (code <= 57) return 'Drizzle';
    if (code <= 67) return 'Rain';
    if (code <= 77) return 'Snow';
    if (code <= 82) return 'Showers';
    if (code <= 86) return 'Snow showers';
    return 'Thunderstorm';
  };

  async function fetchWeather() {
    const base = `https://api.open-meteo.com/v1/forecast?latitude=${resort.lat}&longitude=${resort.lon}&timezone=Europe%2FParis`;
    const [village, top] = await Promise.all([
      fetch(`${base}&elevation=${resort.altitude}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,snowfall_sum&forecast_days=7`),
      fetch(`${base}&elevation=${resort.summit}&current=temperature_2m`),
    ]);
    if (!village.ok || !top.ok) throw new Error('Weather request failed');
    const v = await village.json();
    const t = await top.json();
    return {
      at: Date.now(),
      village: Math.round(v.current.temperature_2m),
      top: Math.round(t.current.temperature_2m),
      label: wmoLabel(v.current.weather_code),
      days: v.daily.time.map((date, i) => ({
        date,
        label: wmoLabel(v.daily.weather_code[i]),
        hi: Math.round(v.daily.temperature_2m_max[i]),
        lo: Math.round(v.daily.temperature_2m_min[i]),
        snow: Math.round(v.daily.snowfall_sum[i]),
      })),
    };
  }

  async function loadWeather() {
    const el = document.getElementById('weather');
    let w = load('weather', null);
    if (!w || Date.now() - w.at > 3600000) {
      try { w = await fetchWeather(); save('weather', w); }
      catch (e) { /* offline: fall back to the saved forecast, if any */ }
    }
    if (!el.isConnected) return;
    if (!w) {
      el.innerHTML = '<p class="muted">No forecast available right now. Check your connection and try again.</p>';
      return;
    }
    const stale = Date.now() - w.at > 3600000;
    el.innerHTML = `<div class="wx-now">
        <div><span class="wx-temp">${w.village}°</span><span class="muted">Resort, ${resort.altitude.toLocaleString('en-GB')} m · ${esc(w.label)}</span></div>
        <div><span class="wx-temp">${w.top}°</span><span class="muted">Up high, ${resort.summit.toLocaleString('en-GB')} m</span></div>
      </div>
      <ul class="wx-days" aria-label="Seven-day forecast">
        ${w.days.map((d) => `<li>
          <strong>${esc(fmtDate(d.date, { weekday: 'short' }))}</strong>
          <span class="wx-label">${esc(d.label)}</span>
          <span>${d.hi}° / ${d.lo}°</span>
          <span class="wx-snow ${d.snow > 0 ? 'has-snow' : ''}">${d.snow > 0 ? `${d.snow} cm` : 'No snow'}</span>
        </li>`).join('')}
      </ul>
      <p class="muted small">${stale ? `Saved ${esc(new Date(w.at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }))}. ` : ''}Model forecast for the next seven days, not an official snow report.</p>`;
  }

  /* ---------- plan ---------- */
  function timelineHtml(day) {
    const t = now();
    return `<ul class="timeline">
      ${day.items.map((item) => `<li class="tl-item ${itemMoment(day, item) < t ? 'is-past' : ''}">
        <span class="tl-time">${esc(item.when || '')}</span>
        <div class="tl-body">
          <span class="tl-type">${esc(TYPE_LABEL[item.type] || item.type)} <span class="badge status-${esc(item.status)}">${esc(STATUS_LABEL[item.status])}</span></span>
          <strong>${esc(item.title)}</strong>
          ${item.detail ? `<span class="muted">${esc(item.detail)}</span>` : ''}
        </div>
      </li>`).join('')}
    </ul>`;
  }

  function renderPlan() {
    const hasToday = trip.days.some((d) => d.date === today());
    view.innerHTML = `<h1 class="page-title">Day by day</h1>
      <p class="muted lede">Only items marked Booked come from your confirmations. Ideas are suggestions to change as you like.</p>
      ${hasToday ? '<button class="btn btn-quiet" data-action="jump-today">Jump to today</button>' : ''}
      ${trip.days.map((day, i) => `<article class="day ${day.date === today() ? 'is-today' : ''}" id="day-${esc(day.date)}">
        <header class="day-head">
          <p class="eyebrow">Day ${i + 1} · ${esc(dayDate(day.date))}${day.date === today() ? ' · Today' : ''}</p>
          <h2>${esc(day.title)}</h2>
        </header>
        ${timelineHtml(day)}
      </article>`).join('')}
      <section>
        <h2 class="section-title">Getting to the resort</h2>
        <p class="muted lede">Transfer times from Club Med. Add time for snow and for winter Sunday traffic.</p>
        <ul class="gateways">
          ${trip.gateways.map((g) => `<li>
            <strong class="gw-time">${esc(g.time)}</strong>
            <span><strong>${esc(g.name)}</strong><small class="muted">${esc(g.note)}</small></span>
          </li>`).join('')}
        </ul>
      </section>`;
  }

  /* ---------- map ---------- */
  const STATUS_COLOR = { resort: '#1f3a8a', region: '#c8102e' };

  function renderMap() {
    view.innerHTML = `<h1 class="page-title">The map</h1>
      <div class="chips" role="group" aria-label="Zoom to">
        <button class="chip" data-action="map-fit" data-fit="resort">The resort</button>
        <button class="chip" data-action="map-fit" data-fit="region">Day trips</button>
        <button class="chip" data-action="map-fit" data-fit="all">Airports too</button>
      </div>
      <div id="map" class="map"></div>
      <p class="legend">
        <span><i class="dot" style="background:${STATUS_COLOR.resort}"></i>Around the resort</span>
        <span><i class="dot" style="background:${STATUS_COLOR.region}"></i>Day trips</span>
        <span><i class="dot square"></i>Airports and station</span>
      </p>
      <p class="muted small">The map needs a connection. Everything else works offline.</p>`;

    if (!window.L) {
      document.getElementById('map').innerHTML = '<p class="muted map-fallback">The map could not load.</p>';
      return;
    }
    map = L.map('map', { scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    trip.gateways.forEach((g) => {
      L.marker([g.lat, g.lon], {
        icon: L.divIcon({ className: '', html: '<span class="map-square"></span>', iconSize: [14, 14], iconAnchor: [7, 7] }),
        title: g.name,
      }).addTo(map).bindPopup(`<strong>${esc(g.name)}</strong><br>${esc(g.time)} to the resort`);
    });

    trip.attractions.forEach((a) => {
      L.circleMarker([a.lat, a.lon], { radius: 7, color: '#fff', weight: 2, fillColor: STATUS_COLOR[a.area], fillOpacity: 1 })
        .addTo(map)
        .bindPopup(`<strong>${esc(a.name)}</strong><br>${esc(a.why)}<br><a href="${esc(mapsUrl(a.q))}" target="_blank" rel="noopener">Open in Maps</a>`);
    });

    L.marker([resort.lat, resort.lon], {
      icon: L.divIcon({ className: '', html: '<span class="map-pin">★</span>', iconSize: [34, 34], iconAnchor: [17, 17] }),
      title: resort.name,
      zIndexOffset: 500,
    }).addTo(map).bindPopup(`<strong>${esc(resort.name)}</strong><br>${esc(shortDate(startDate))} to ${esc(shortDate(endDate))}`);

    fitMap('resort');
  }

  function fitMap(which) {
    const home = [resort.lat, resort.lon];
    const pick = (area) => trip.attractions.filter((a) => a.area === area).map((a) => [a.lat, a.lon]);
    const pts = {
      resort: [home, ...pick('resort')],
      region: [home, ...pick('region')],
      all: [home, ...pick('region'), ...trip.gateways.map((g) => [g.lat, g.lon])],
    }[which];
    map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 13 });
  }

  /* ---------- explore ---------- */
  const exploreState = { type: 'All', show: 'all' };
  const TYPES = ['All', ...new Set(trip.attractions.map((a) => a.type))];

  function renderExplore() {
    const favs = load('favs', []);
    const visited = load('visited', []);
    const list = trip.attractions.filter((a) => {
      if (exploreState.type !== 'All' && a.type !== exploreState.type) return false;
      if (exploreState.show === 'saved') return favs.includes(a.name);
      if (exploreState.show === 'todo') return !visited.includes(a.name);
      return true;
    });
    const chip = (group, value, label, active) => `<button class="chip" aria-pressed="${active}" data-action="explore" data-group="${group}" data-value="${esc(value)}">${esc(label)}</button>`;

    view.innerHTML = `<h1 class="page-title">Things to do</h1>
      <p class="muted lede">${visited.length} of ${trip.attractions.length} done · ${favs.length} saved. Drive times are rough estimates in good conditions.</p>
      <div class="chips" role="group" aria-label="Filter by type">
        ${TYPES.map((t) => chip('type', t, t, exploreState.type === t)).join('')}
      </div>
      <div class="chips" role="group" aria-label="Filter by status">
        ${chip('show', 'all', 'Everything', exploreState.show === 'all')}
        ${chip('show', 'saved', 'Saved', exploreState.show === 'saved')}
        ${chip('show', 'todo', 'Not done yet', exploreState.show === 'todo')}
      </div>
      <div class="cards">
        ${list.length ? list.map((a) => {
          const fav = favs.includes(a.name);
          const seen = visited.includes(a.name);
          return `<article class="card area-${esc(a.area)} ${seen ? 'is-seen' : ''}">
            <p class="eyebrow">${esc(a.type)}</p>
            <h2>${esc(a.name)}</h2>
            <p>${esc(a.why)}</p>
            ${a.tip ? `<p class="muted">${esc(a.tip)}</p>` : ''}
            <div class="card-actions">
              <button class="chip" aria-pressed="${fav}" data-action="toggle-list" data-list="favs" data-name="${esc(a.name)}">${fav ? 'Saved' : 'Save'}</button>
              <button class="chip" aria-pressed="${seen}" data-action="toggle-list" data-list="visited" data-name="${esc(a.name)}">${seen ? 'Done' : 'Mark done'}</button>
              <a class="chip" href="${esc(mapsUrl(a.q))}" target="_blank" rel="noopener">Maps</a>
            </div>
          </article>`;
        }).join('') : '<p class="muted">Nothing here with these filters.</p>'}
      </div>`;
  }

  /* ---------- kit ---------- */
  const EMERGENCY = [
    ['112', 'Any emergency, from anywhere in the EU'],
    ['15', 'Medical (SAMU)'],
    ['17', 'Police'],
    ['18', 'Fire'],
    ['114', 'Emergency by text, for deaf or hard-of-hearing callers'],
  ];

  function renderKit() {
    const checked = load('packed', []);
    const extras = load('packExtras', []);
    const groups = { ...trip.packing, ...(extras.length ? { 'Your additions': extras } : {}) };
    const allItems = Object.values(groups).flat();
    const done = allItems.filter((i) => checked.includes(i)).length;
    const refs = load('refs', []);

    view.innerHTML = `<h1 class="page-title">The kit</h1>

      <section>
        <h2 class="section-title">Packing <span class="muted small">${done} of ${allItems.length}</span></h2>
        <progress class="progress" max="${allItems.length}" value="${done}" aria-label="Packing progress"></progress>
        <div class="pack-groups">
          ${Object.entries(groups).map(([group, items]) => `<fieldset class="pack-group">
            <legend>${esc(group)}</legend>
            ${items.map((item) => `<label class="check">
              <input type="checkbox" data-action="toggle-pack" data-name="${esc(item)}" ${checked.includes(item) ? 'checked' : ''}>
              <span>${esc(item)}</span>
            </label>`).join('')}
          </fieldset>`).join('')}
        </div>
        <form class="inline-form" data-form="pack">
          <label class="sr-only" for="pack-input">Add a packing item</label>
          <input id="pack-input" name="item" placeholder="Add an item" autocomplete="off" required>
          <button class="btn" type="submit">Add</button>
        </form>
      </section>

      <section>
        <h2 class="section-title">Booking references</h2>
        <p class="muted">Saved only on this device, so they stay off the public site. You'd need to add them on each phone.</p>
        <ul class="refs">
          ${refs.map((r, i) => `<li>
            <span><strong>${esc(r.label)}</strong><br><code>${esc(r.value)}</code></span>
            <button class="chip" data-action="del-ref" data-index="${i}" aria-label="Remove ${esc(r.label)}">Remove</button>
          </li>`).join('')}
        </ul>
        <form class="inline-form" data-form="ref">
          <label class="sr-only" for="ref-label">What it's for</label>
          <input id="ref-label" name="label" placeholder="e.g. Club Med" autocomplete="off" required>
          <label class="sr-only" for="ref-value">Reference</label>
          <input id="ref-value" name="value" placeholder="Reference" autocomplete="off" required>
          <button class="btn" type="submit">Save</button>
        </form>
      </section>

      <section>
        <h2 class="section-title">In an emergency</h2>
        <ul class="emergency">
          ${EMERGENCY.map(([num, what]) => `<li><a class="em-num" href="${num === '114' ? 'sms' : 'tel'}:${num}">${num}</a><span>${esc(what)}</span></li>`).join('')}
        </ul>
      </section>

      <section>
        <h2 class="section-title">Useful French</h2>
        <dl class="phrases">
          ${trip.phrases.map(([en, fr, say]) => `<div><dt>${esc(en)}</dt><dd lang="fr"><strong>${esc(fr)}</strong></dd><dd class="muted">${esc(say)}</dd></div>`).join('')}
        </dl>
      </section>

      <section>
        <h2 class="section-title">Good to know</h2>
        <dl class="practical">
          ${trip.practical.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
        </dl>
      </section>`;
  }

  /* Re-render the kit without losing the reader's place on the page. */
  function refreshKit() {
    const y = window.scrollY;
    renderKit();
    window.scrollTo({ top: y, behavior: 'instant' });
  }

  /* ---------- events ---------- */
  view.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    if (!el) return;
    const { action } = el.dataset;
    if (action === 'jump-today') {
      const target = document.getElementById(`day-${today()}`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (action === 'jump-lessons') {
      document.getElementById('lessons').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (action === 'map-fit') {
      fitMap(el.dataset.fit);
    } else if (action === 'explore') {
      exploreState[el.dataset.group] = el.dataset.value;
      renderExplore();
    } else if (action === 'toggle-list') {
      const list = load(el.dataset.list, []);
      save(el.dataset.list, toggled(list, el.dataset.name, !list.includes(el.dataset.name)));
      renderExplore();
    } else if (action === 'del-ref') {
      const refs = load('refs', []);
      refs.splice(Number(el.dataset.index), 1);
      save('refs', refs);
      refreshKit();
    }
  });

  view.addEventListener('change', (event) => {
    const el = event.target;
    if (el.dataset.action === 'toggle-pack') {
      save('packed', toggled(load('packed', []), el.dataset.name, el.checked));
      refreshKit();
    } else if (el.dataset.action === 'toggle-todo') {
      const done = toggled(load('todos', []), el.dataset.id, el.checked);
      save('todos', done);
      document.getElementById('todo-count').textContent = `${trip.todos.filter((t) => done.includes(t.id)).length} of ${trip.todos.length} done`;
    }
  });

  view.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    if (form.dataset.form === 'pack') {
      const item = String(data.get('item')).trim();
      if (item) save('packExtras', toggled(load('packExtras', []), item, true));
    } else if (form.dataset.form === 'ref') {
      const label = String(data.get('label')).trim();
      const value = String(data.get('value')).trim();
      if (label && value) save('refs', [...load('refs', []), { label, value }]);
    }
    refreshKit();
  });

  window.addEventListener('hashchange', route);

  /* ---------- boot ---------- */
  route();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
