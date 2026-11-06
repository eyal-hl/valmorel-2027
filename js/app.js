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
  const save = (key, value) => {
    try { localStorage.setItem(storeKey(key), JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
    if (window.CarnetSync) window.CarnetSync.changed(key);
  };
  const newId = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const sync = window.CarnetSync || { configured: false, active: false, status: { state: 'off' }, changed() {} };
  const sharing = () => sync.active || Boolean(sync.tripId);

  /* ---------- people ---------- */
  // Who this phone belongs to. Kept on the phone only. Until it's set, your
  // food ratings are filed under 'me'.
  const meId = () => load('me', null) || 'me';
  const people = () => load('people', []);
  const personName = (id) => (people().find((p) => p.id === id) || {}).name || (id === meId() ? 'You' : 'Someone');
  function setMe(id) {
    const log = load('foodLog', {});
    Object.values(log).forEach((entry) => {
      ['ratings', 'notes'].forEach((field) => {
        const m = entry[field];
        if (m && 'me' in m) {
          if (!(id in m)) m[id] = m.me;
          delete m.me;
        }
      });
    });
    save('foodLog', log);
    save('me', id);
  }
  const toggled = (list, value, on) => (on ? [...list.filter((v) => v !== value), value] : list.filter((v) => v !== value));

  const mapsUrl = (query) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  const TYPE_LABEL = { flight: 'Flight', train: 'Train', car: 'Transfer', hotel: 'Stay', ski: 'Ride', sight: 'Explore', food: 'Eat', note: 'Note' };
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
  const icon = (path) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  const TABS = [
    ['home', 'Home', icon('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>')],
    ['plan', 'Plan', icon('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>')],
    ['explore', 'Explore', icon('<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>')],
    ['food', 'Food', icon('<path d="M7 3v7a2 2 0 0 0 2 2v9M4 3v5M10 3v5"/><path d="M17 21v-7h-2V7a4 4 0 0 1 4-4v18"/>')],
    ['info', 'Info', icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5h.01"/>')],
  ];
  const LEGACY = { map: 'explore/map', included: 'info/included', mountain: 'info/slopes', kit: 'info/kit', money: 'info/money' };
  function parseRoute() {
    const hash = location.hash.slice(1);
    const [tab, sub] = (LEGACY[hash] || hash).split('/');
    return TABS.some(([t]) => t === tab) ? { tab, sub } : { tab: 'home' };
  }
  const currentTab = () => parseRoute().tab;

  const EXPLORE_VIEWS = [['map', 'Map'], ['things', 'Things to do'], ['evenings', 'Evenings']];
  const INFO_VIEWS = [['included', 'Included'], ['slopes', 'Slopes'], ['money', 'Money'], ['kit', 'Kit']];
  const segHtml = (base, items, active) => `<nav class="seg" aria-label="Views">${items.map(([id, label]) => `<a href="#${base}/${id}" ${id === active ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;

  let map = null;
  let ticker = null;

  function route() {
    if (ticker) { clearInterval(ticker); ticker = null; }
    removeMap();
    const joinId = (location.hash.match(/^#join\/([A-Za-z0-9]{20,40})$/) || [])[1];
    if (joinId) {
      document.getElementById('nav').innerHTML = TABS
        .map(([id, label, svg]) => `<a href="#${id}">${svg}<span>${label}</span></a>`).join('');
      document.body.classList.remove('is-map');
      renderJoin(joinId);
      window.scrollTo(0, 0);
      return;
    }
    const { tab, sub } = parseRoute();
    document.getElementById('nav').innerHTML = TABS
      .map(([id, label, svg]) => `<a href="#${id}" ${id === tab ? 'aria-current="page"' : ''}>${svg}<span>${label}</span></a>`)
      .join('');
    document.body.classList.toggle('is-map', tab === 'explore' && (sub || 'map') === 'map');
    ({ home: renderHome, plan: renderPlan, explore: () => renderExplore(sub || 'map'), food: renderFood, info: () => renderInfo(sub || 'included') })[tab]();
    window.scrollTo(0, 0);
  }

  function renderInfo(sub) {
    const views = { included: renderIncluded, slopes: renderMountain, money: renderMoney, kit: renderKit };
    const active = views[sub] ? sub : 'included';
    views[active]();
    view.insertAdjacentHTML('afterbegin', segHtml('info', INFO_VIEWS, active));
  }

  const foldHtml = (title, body, { open = false, extra = '' } = {}) => `<details class="fold" ${open ? 'open' : ''}>
    <summary><span class="fold-title">${title}</span>${extra}</summary>
    <div class="fold-body">${body}</div>
  </details>`;

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
    if (!day) return '';
    const mapDay = trip.mapDays.find((m) => m.date === today());
    const t = now();
    const later = day.items.filter((item) => itemMoment(day, item) > t);
    const lesson = later.find((item) => /lesson/i.test(item.title));
    const tonight = day.items.find((item) => itemMoment(day, item).getHours() >= 17);
    const row = (label, value, extra = '') => `<li><span class="today-label">${label}</span><span class="today-value">${value}${extra}</span></li>`;
    return `<section class="today">
      <h2>${esc(day.title)}</h2>
      <ul class="today-list">
        ${mapDay ? row('Route', esc(mapDay.route ? mapDay.title : 'No route today'), ` <button class="chip map-btn" data-action="map-this-day" data-date="${esc(day.date)}">Open map</button>`) : ''}
        ${lesson ? row('Lesson', `${esc(lesson.when || '')}. Check the time at the resort.`) : ''}
        ${mapDay && mapDay.lastLift ? row('Last lift', `<strong>${esc(mapDay.lastLift)}</strong>`) : ''}
        ${tonight ? row('Tonight', esc(tonight.title)) : ''}
      </ul>
      <details class="fold"><summary><span class="fold-title">Full day</span></summary><div class="fold-body">${timelineHtml(day)}</div></details>
    </section>`;
  }

  function todosHtml() {
    if (phase() === 'after') return '';
    const done = load('todos', []);
    const count = trip.todos.filter((t) => done.includes(t.id)).length;
    return foldHtml('Still to sort', `<div class="todos">
        ${trip.todos.map((t) => `<label class="check todo">
          <input type="checkbox" data-action="toggle-todo" data-id="${esc(t.id)}" ${done.includes(t.id) ? 'checked' : ''}>
          <span><strong>${esc(t.title)}</strong><small class="muted">${esc(t.detail)}${t.url ? ` <a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.urlLabel)}</a>` : ''}</small></span>
        </label>`).join('')}
      </div>`, { extra: `<span class="muted small" id="todo-count">${count} of ${trip.todos.length} done</span>` });
  }

  function datesHtml() {
    if (phase() === 'after') return '';
    const t = today();
    const until = (date) => {
      const n = dayDiff(t, date);
      if (n === 0) return 'Today';
      if (n < 0) return 'Done';
      return n === 1 ? 'Tomorrow' : `In ${n} days`;
    };
    const next = trip.dates.find((k) => k.date >= t);
    return foldHtml('Key dates', `<ul class="key-dates">
        ${trip.dates.map((k) => `<li class="${k.date < t ? 'is-past' : ''}">
          <span class="kd-when"><strong>${esc(shortDate(k.date))}</strong><small class="muted">${esc(until(k.date))}</small></span>
          <span><strong>${esc(k.title)}</strong><small class="muted">${esc(k.detail)}</small></span>
        </li>`).join('')}
      </ul>
      <button class="btn btn-quiet" data-action="calendar">Add to my calendar</button>`, { extra: next ? `<span class="muted small">Next: ${esc(shortDate(next.date))}</span>` : '' });
  }

  function calendarText() {
    const compact = (ymd) => ymd.replace(/-/g, '');
    const nextDay = (ymd) => new Date(toUTC(ymd) + 86400000).toISOString().slice(0, 10);
    const text = (s) => s.replace(/([\\,;])/g, '\\$1');
    const stamp = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
    const fold = (line) => {
      const parts = [];
      for (let i = 0; i < line.length; i += 60) parts.push(line.slice(i, i + 60));
      return parts.join('\r\n ');
    };
    const events = trip.dates.filter((k) => k.date >= today()).flatMap((k) => [
      'BEGIN:VEVENT',
      `UID:${k.date}-${compact(k.title).replace(/\W/g, '')}@valmorel-2027`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(k.date)}`,
      `DTEND;VALUE=DATE:${compact(nextDay(k.date))}`,
      `SUMMARY:${text(k.title)}`,
      `DESCRIPTION:${text(k.detail)}`,
      'END:VEVENT',
    ]);
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Carnet de France//Valmorel 2027//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR']
      .map(fold).join('\r\n');
  }

  function downloadCalendar() {
    const url = URL.createObjectURL(new Blob([calendarText()], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'valmorel-2027.ics';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function stayHtml() {
    return foldHtml("Where you're staying", `<div class="stay-main">
        <h3>${esc(resort.name)}</h3>
        <p class="muted">${esc(resort.region)} · ${esc(plural(resort.guests, 'guest'))} · ${esc(plural(resort.nights, 'night'))}</p>
        <p>${esc(resort.blurb)}</p>
        <p class="muted">${esc(resort.address)}</p>
        <div class="card-actions">
          <a class="chip" href="#info/included">What's included</a>
          ${mapButton(resort.lat, resort.lon, resort.name)}
          <a class="chip" href="${esc(mapsUrl(resort.name))}" target="_blank" rel="noopener">Open in Maps</a>
          <a class="chip" href="${esc(resort.site)}" target="_blank" rel="noopener">Club Med page</a>
        </div>
      </div>`);
  }

  /* ---------- included ---------- */
  function renderIncluded() {
    const payRows = (rows) => `<ul class="pay-list">${rows.map((r) => `<li>
      <strong>${esc(r.title)}</strong>
      <span class="muted">${esc(r.detail)}</span>
      ${r.lat ? mapButton(r.lat, r.lon, r.title) : ''}
    </li>`).join('')}</ul>`;

    const { lessons } = trip;
    const levelRows = (rows) => `<dl class="levels">${rows.map(([level, what]) => `<div><dt>${esc(level)}</dt><dd>${esc(what)}</dd></div>`).join('')}</dl>`;

    view.innerHTML = `<h1 class="page-title">What's included</h1>
      <p class="muted lede">Mostly from Club Med's public pages, not your own contract. Your voucher is the final word.</p>
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

      <section>
        <h2 class="section-title">What your lift pass doesn't cover</h2>
        <p>${esc(trip.liftPass.intro)}</p>
        <ul class="inc-list no-list">${trip.liftPass.notCovered.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
        <p class="muted small">${esc(trip.liftPass.check)}</p>
      </section>

      <section id="lessons" class="lessons">
        <h2 class="section-title">How group lessons work</h2>
        <p>${esc(lessons.summary)}</p>
        <dl class="facts">${lessons.facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>

        <h3 class="sub-title">Your week, step by step</h3>
        <ol class="steps">
          ${lessons.steps.map((s) => `<li><strong>${esc(s.title)}</strong><span class="muted">${esc(s.detail)}</span></li>`).join('')}
        </ol>

        <h3 class="sub-title">A typical day</h3>
        <dl class="levels day-times">${lessons.day.map(([time, what]) => `<div><dt>${esc(time)}</dt><dd>${esc(what)}</dd></div>`).join('')}</dl>
        <p class="muted small">${esc(lessons.dayNote)}</p>

        <h3 class="sub-title">Which level are you?</h3>
        ${levelRows(lessons.board)}
        <p class="muted small">${esc(lessons.levelNote)}</p>

        <h3 class="sub-title">What guests say</h3>
        <dl class="facts">${lessons.reviews.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>

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
    const during = phase() === 'during';
    const weather = foldHtml('Valmorel right now', '<div id="weather"><p class="muted">Loading the forecast…</p></div>', { open: during, extra: '<span class="muted small" id="wx-summary"></span>' });
    view.innerHTML = during
      ? `${heroHtml()}${todayHtml()}${nextUpHtml()}${weather}${stayHtml()}`
      : `${heroHtml()}${nextUpHtml()}<div class="folds">${todosHtml()}${datesHtml()}${weather}${stayHtml()}</div>`;
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
    const wxSummary = document.getElementById('wx-summary');
    if (wxSummary) wxSummary.textContent = `${w.village}° · ${w.label}`;
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

  const JOURNAL_FIELDS = [
    ['run', 'Best run'],
    ['food', 'Best thing we ate'],
    ['notes', 'Notes'],
  ];

  function journalHtml(day) {
    const entry = load('journal', {})[day.date] || {};
    const filled = JOURNAL_FIELDS.some(([key]) => entry[key]);
    return `<details class="journal">
      <summary>Journal<span class="muted small" data-journal-mark="${esc(day.date)}">${filled ? ' · has notes' : ''}</span></summary>
      ${JOURNAL_FIELDS.map(([key, label]) => {
        const id = `j-${day.date}-${key}`;
        const attrs = `id="${id}" data-action="journal" data-date="${esc(day.date)}" data-field="${key}" autocomplete="off"`;
        return `<label for="${id}">${esc(label)}</label>${key === 'notes'
          ? `<textarea ${attrs} rows="3">${esc(entry[key] || '')}</textarea>`
          : `<input ${attrs} value="${esc(entry[key] || '')}">`}`;
      }).join('')}
    </details>`;
  }

  function journalText() {
    const journal = load('journal', {});
    return trip.days.map((day) => {
      const entry = journal[day.date] || {};
      const lines = JOURNAL_FIELDS.filter(([key]) => entry[key]).map(([key, label]) => `${label}: ${entry[key]}`);
      return lines.length ? [`${dayDate(day.date)}: ${day.title}`, ...lines].join('\n') : null;
    }).filter(Boolean).join('\n\n');
  }

  async function copyJournal() {
    const status = document.getElementById('journal-status');
    const text = journalText();
    if (!text) { status.textContent = 'Nothing to copy yet.'; return; }
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = 'Copied.';
    } catch (e) {
      status.textContent = "Couldn't copy on this device. Try opening the site in your browser instead.";
    }
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
        ${trip.mapDays.some((m) => m.date === day.date) ? `<button class="chip map-this-day" data-action="map-this-day" data-date="${esc(day.date)}">${icon('<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>')} Map this day</button>` : ''}
        ${journalHtml(day)}
      </article>`).join('')}
      <section>
        <h2 class="section-title">Your journal</h2>
        <p class="muted lede">${sharing() ? 'Notes are shared with your group as you type.' : `Notes are saved on this phone only. Copy them somewhere safe at the end of the trip${sync.configured ? ', or turn on sharing in Money' : ''}.`}</p>
        <button class="btn btn-quiet" data-action="copy-journal">Copy the whole journal</button>
        <p class="muted small" id="journal-status" role="status"></p>
      </section>
      <section>
        <h2 class="section-title">Transfer times</h2>
        <p class="muted lede">Club Med is handling your flights and transfers. These are its typical times to the resort, for reference.</p>
        <ul class="gateways">
          ${trip.gateways.map((g) => `<li>
            <strong class="gw-time">${esc(g.time)}</strong>
            <span><strong>${esc(g.name)}</strong><small class="muted">${esc(g.note)}</small>${mapButton(g.lat, g.lon, g.name)}</span>
          </li>`).join('')}
        </ul>
      </section>`;
  }

  /* ---------- map ---------- */
  const STATUS_COLOR = { resort: '#1f3a8a', region: '#c8102e' };
  const PISTE_COLOR = { novice: '#2e8b57', easy: '#2563c9', intermediate: '#d0212a', advanced: '#111111' };
  const PISTE_NAME = { novice: 'Green', easy: 'Blue', intermediate: 'Red', advanced: 'Black' };
  const COLOUR_HEX = { green: '#2e8b57', blue: '#2563c9', red: '#d0212a', black: '#111111' };
  // Only exceptions are shown. Anything without a label is covered or doesn't need a pass.
  const PASS_LABEL = { extra: 'Costs extra', separate: 'Needs a separate pass', meal: 'Meal costs extra' };
  const mapState = { day: null, base: 'piste', step: -1, focus: null };
  let overlay = null;
  let builtBase = null;
  let stepLines = [];
  let stepPins = [];
  const pisteMarkers = new Map();

  const isPiste = () => builtBase === 'piste';
  const currentMapDay = () => trip.mapDays.find((m) => m.id === mapState.day) || null;
  const inMapView = () => { const { tab, sub } = parseRoute(); return tab === 'explore' && (sub || 'map') === 'map'; };
  const toMapPoint = ([x, y]) => [trip.pisteMap.height - y, x];
  const routeText = (day) => (day && day.route && window.MOUNTAIN ? window.MOUNTAIN.routes[day.route] : []);
  const routeShape = (day) => {
    if (!day || !day.route || !window.MOUNTAIN) return [];
    return isPiste() ? window.MOUNTAIN.pisteRoutes[day.route] : window.MOUNTAIN.routes[day.route];
  };
  const shapePoints = (points) => (isPiste() ? points.map(toMapPoint) : points);

  function mapButton(lat, lon, label, num) {
    return `<button class="chip map-btn" data-action="go-map" data-lat="${lat}" data-lon="${lon}" data-label="${esc(label)}" ${num ? `data-num="${num}"` : ''}>On the map</button>`;
  }

  function goToMap(lat, lon, label, num) {
    mapState.day = 'all';
    mapState.step = -1;
    mapState.base = num ? 'piste' : 'street';
    mapState.focus = { lat, lon, label, num };
    if (inMapView() && map) mountMap();
    else location.hash = '#explore/map';
  }

  function openMapDay(date) {
    const day = trip.mapDays.find((m) => m.date === date);
    mapState.day = day.id;
    mapState.step = -1;
    mapState.base = day.route ? 'piste' : 'street';
    mapState.focus = null;
    location.hash = '#explore/map';
  }

  function applyMapFocus() {
    const focus = mapState.focus;
    if (!focus || !map || !overlay) return;
    mapState.focus = null;
    if (focus.num && isPiste()) {
      const marker = pisteMarkers.get(focus.num);
      if (marker) {
        map.setView(marker.getLatLng(), -0.5);
        marker.openPopup();
      }
      return;
    }
    const at = [focus.lat, focus.lon];
    const marker = L.marker(at, {
      icon: L.divIcon({ className: '', html: '<span class="map-focus"></span>', iconSize: [24, 24], iconAnchor: [12, 12] }),
      zIndexOffset: 800,
    }).addTo(overlay).bindPopup(`<strong>${esc(focus.label)}</strong><br><a href="${esc(mapsUrl(`${focus.lat},${focus.lon}`))}" target="_blank" rel="noopener">Open in Maps</a>`);
    map.setView(at, 14);
    marker.openPopup();
  }

  function removeMap() {
    if (map) { map.remove(); map = null; }
    overlay = null;
    builtBase = null;
    stepLines = [];
    stepPins = [];
    pisteMarkers.clear();
  }

  function buildStreetMap(holder) {
    map = L.map(holder, { scrollWheelZoom: false, preferCanvas: true, renderer: L.canvas({ tolerance: 8 }) });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    const data = window.MOUNTAIN;
    if (!data) return;
    data.pistes.forEach((p) => {
      const level = PISTE_NAME[p.d];
      L.polyline(p.p, { color: PISTE_COLOR[p.d] || '#777777', weight: 2.5, opacity: 0.6 }).addTo(map)
        .bindPopup(`<strong>${esc(p.n || (p.k === 'park' ? 'Snow park' : 'Piste'))}</strong>${level ? `<br>${level} run` : ''}`);
    });
    data.lifts.forEach((l) => {
      const zip = l.t === 'zip line';
      const clubMed = l.n.startsWith('Club Med');
      L.polyline(l.p, { color: '#14213d', weight: 2, opacity: 0.85, dashArray: zip ? '2 6' : '6 4' }).addTo(map)
        .bindPopup(`<strong>${esc(l.n || 'Lift')}</strong><br>${esc(l.t)}${zip ? '<br>Not on your lift pass, book separately' : clubMed ? '<br>Club Med beginner carpet' : ''}`);
    });
  }

  function buildPisteMap(holder) {
    const pm = trip.pisteMap;
    const bounds = [[0, 0], [pm.height, pm.width]];
    map = L.map(holder, { crs: L.CRS.Simple, minZoom: -3, maxZoom: 1, zoomSnap: 0, scrollWheelZoom: false, maxBoundsViscosity: 0.8 });
    map.attributionControl.setPrefix(false);
    L.imageOverlay(pm.image, bounds, { attribution: 'Piste map © Valmorel' }).addTo(map);
    map.setMinZoom(Math.log2(Math.min(holder.clientWidth / pm.width, holder.clientHeight / pm.height)));
    map.setMaxBounds(bounds);
    showPisteOverview();
  }

  function showPisteOverview() {
    const pm = trip.pisteMap;
    const holder = map.getContainer();
    // Fill the box rather than fitting the whole map, so numbers stay readable on a phone.
    const fillZoom = Math.log2(Math.max(holder.clientWidth / pm.width, holder.clientHeight / pm.height));
    map.setView(toMapPoint([850, pm.height / 2]), fillZoom);
  }

  function mountMap() {
    removeMap();
    updateMapControls();
    const holder = document.getElementById('map');
    if (!holder) return;
    if (!window.L) {
      holder.innerHTML = '<p class="muted map-fallback">The map could not load.</p>';
      renderRouteCard();
      return;
    }
    builtBase = mapState.base;
    if (isPiste()) buildPisteMap(holder);
    else buildStreetMap(holder);
    overlay = L.layerGroup().addTo(map);
    drawDay();
    applyMapFocus();
  }

  function updateMapControls() {
    document.querySelectorAll('[data-action="map-day"]').forEach((b) => {
      const on = b.dataset.day === mapState.day;
      b.setAttribute('aria-pressed', String(on));
      if (on) b.parentElement.scrollLeft = b.offsetLeft - b.parentElement.offsetLeft - 60;
    });
    document.querySelectorAll('[data-action="map-base"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.base === mapState.base)));
    updateCompass();
  }

  function updateCompass() {
    const compass = document.getElementById('compass');
    if (!compass) return;
    const piste = mapState.base === 'piste';
    const angle = piste ? trip.pisteMap.northAngle : 0;
    const rad = (angle * Math.PI) / 180;
    // The needle turns with the map, but the N stays upright so it can be read.
    compass.innerHTML = `<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
      <g transform="rotate(${angle} 24 24)">
        <path d="M24 13l5 11h-10z" fill="#c8102e"/>
        <path d="M24 35l5-11h-10z" fill="#9aa3b5"/>
      </g>
      <text x="${(24 + 18 * Math.sin(rad)).toFixed(1)}" y="${(24 - 18 * Math.cos(rad)).toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="11" font-weight="700" fill="#c8102e">N</text>
    </svg>${piste ? '<span>Facing south</span>' : ''}`;
    compass.setAttribute('aria-label', piste
      ? 'North is roughly towards the bottom of this map, because it faces south.'
      : 'North is at the top of this map.');
    compass.title = compass.getAttribute('aria-label');
  }

  function addResortMarker() {
    const star = isPiste()
      ? { at: toMapPoint(trip.pisteMap.clubMed), html: '<span class="piste-num piste-star">★</span>', size: 28, text: '<strong>Club Med Valmorel</strong><br>Approximate position. The map does not show the resort.' }
      : { at: [resort.lat, resort.lon], html: '<span class="map-pin">★</span>', size: 34, text: `<strong>${esc(resort.name)}</strong><br>${esc(shortDate(startDate))} to ${esc(shortDate(endDate))}` };
    const marker = L.marker(star.at, {
      icon: L.divIcon({ className: '', html: star.html, iconSize: [star.size, star.size], iconAnchor: [star.size / 2, star.size / 2] }),
      zIndexOffset: 500,
      title: resort.name,
    }).addTo(overlay).bindPopup(star.text);
    pisteMarkers.set(0, marker);
  }

  function drawPlaces() {
    if (isPiste()) {
      trip.attractions.filter((x) => x.pistePins).forEach((x) => {
        const html = `<strong>${x.pisteNum}. ${esc(x.name)}</strong><br>${esc(x.why)}${PASS_LABEL[x.pass] ? `<br><em>${esc(PASS_LABEL[x.pass])}</em>` : ''}`;
        x.pistePins.forEach((p) => {
          const marker = L.marker(toMapPoint(p), {
            icon: L.divIcon({ className: '', html: `<span class="piste-num">${x.pisteNum}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
          }).addTo(overlay).bindPopup(html);
          if (!pisteMarkers.has(x.pisteNum)) pisteMarkers.set(x.pisteNum, marker);
        });
      });
      showPisteOverview();
      return;
    }
    trip.gateways.forEach((g) => {
      L.marker([g.lat, g.lon], {
        icon: L.divIcon({ className: '', html: '<span class="map-square"></span>', iconSize: [14, 14], iconAnchor: [7, 7] }),
        title: g.name,
      }).addTo(overlay).bindPopup(`<strong>${esc(g.name)}</strong><br>${esc(g.time)} to the resort`);
    });
    trip.attractions.forEach((x) => {
      L.circleMarker([x.lat, x.lon], { radius: 7, color: '#fff', weight: 2, fillColor: STATUS_COLOR[x.area], fillOpacity: 1 }).addTo(overlay)
        .bindPopup(`<strong>${esc(x.name)}</strong><br>${esc(x.why)}${PASS_LABEL[x.pass] ? `<br><em>${esc(PASS_LABEL[x.pass])}</em>` : ''}<br><a href="${esc(mapsUrl(x.q))}" target="_blank" rel="noopener">Open in Maps</a>`);
    });
    fitMap('resort');
  }

  function drawDay() {
    renderRouteCard();
    if (!map || !overlay) return;
    map.invalidateSize();
    overlay.clearLayers();
    pisteMarkers.clear();
    stepLines = [];
    stepPins = [];
    addResortMarker();
    const day = currentMapDay();
    const legs = routeShape(day);
    if (!day || (isPiste() && !legs.length)) {
      drawPlaces();
      return;
    }
    legs.forEach((leg, i) => {
      const pts = shapePoints(leg.p);
      if (leg.k === 'ride') L.polyline(pts, { color: '#ffffff', weight: 9, opacity: 0.9 }).addTo(overlay);
      stepLines[i] = L.polyline(pts, { color: leg.k === 'lift' ? '#14213d' : '#ff6a00', weight: 5, opacity: 1 }).addTo(overlay);
      if (leg.home) L.polyline(shapePoints(leg.home), { color: '#ff6a00', weight: 4, dashArray: '4 8' }).addTo(overlay);
      stepPins[i] = L.marker(pts[0], {
        icon: L.divIcon({ className: '', html: `<span class="map-step">${i + 1}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
        zIndexOffset: 400 + i,
      }).addTo(overlay);
      stepPins[i].on('click', () => setStep(i));
    });
    if (!isPiste()) {
      day.stops.forEach((s) => {
        L.circleMarker([s.lat, s.lon], { radius: 8, color: '#fff', weight: 2, fillColor: '#6b2fa0', fillOpacity: 1 }).addTo(overlay)
          .bindPopup(`<strong>${esc(s.name)}</strong><br>${esc(s.note)}`);
      });
    }
    fitStep();
  }

  function fitStep() {
    const day = currentMapDay();
    const holder = map.getContainer();
    const overview = mapState.step < 0;
    holder.classList.toggle('is-overview', overview);
    stepLines.forEach((line, i) => {
      const active = i === mapState.step;
      line.setStyle({ weight: active ? 8 : 5, opacity: overview || active ? 1 : 0.4 });
      if (active) line.bringToFront();
    });
    if (overview) {
      const points = stepLines.flatMap((line) => line.getLatLngs());
      if (!isPiste()) {
        points.push(L.latLng(resort.lat, resort.lon));
        day.stops.forEach((s) => points.push(L.latLng(s.lat, s.lon)));
      }
      if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [34, 34], maxZoom: isPiste() ? 0 : 14 });
      return;
    }
    const line = stepLines[mapState.step];
    if (line) map.fitBounds(line.getBounds(), { padding: [46, 46], maxZoom: isPiste() ? 0 : 15 });
  }

  function setStep(i) {
    const count = routeText(currentMapDay()).length;
    mapState.step = Math.max(-1, Math.min(i, count - 1));
    renderRouteCard();
    if (!map) return;
    map.invalidateSize();
    fitStep();
  }

  function legTitle(leg) {
    return leg.k === 'lift' ? `${esc(leg.n)} ${esc(leg.t)}` : `Ride down, about ${(leg.len / 1000).toFixed(1)} km`;
  }
  function legDetail(leg) {
    return leg.k === 'lift'
      ? ''
      : `<span class="run-names">${leg.names.map((n) => `<span><i class="dot" style="background:${COLOUR_HEX[n.c] || '#777'}"></i>${esc(n.n)}</span>`).join('')}</span>`;
  }

  function renderRouteCard() {
    const card = document.getElementById('route-card');
    if (!card) return;
    const day = currentMapDay();
    const pm = trip.pisteMap;
    if (!day) {
      const pinned = trip.attractions.filter((x) => x.pistePins).sort((x, y) => x.pisteNum - y.pisteNum);
      const offMap = trip.attractions.filter((x) => !x.pistePins);
      card.innerHTML = mapState.base === 'piste'
        ? `<p class="route-hint">Tap a number, or pick a day for its route.</p>
          <details class="fold"><summary><span class="fold-title">Key</span></summary><div class="fold-body">
            <ol class="piste-key">
              <li><button class="leg" data-action="piste-focus" data-num="0"><span class="piste-num piste-star">★</span><span>Club Med (approximate)</span></button></li>
              ${pinned.map((x) => `<li><button class="leg" data-action="piste-focus" data-num="${x.pisteNum}"><span class="piste-num">${x.pisteNum}</span><span>${esc(x.name)}</span></button></li>`).join('')}
            </ol>
            <p class="muted small">Not on this map: ${esc(offMap.map((x) => x.name).join(', '))}. Switch to Street to see them.</p>
            <div class="card-actions">
              <a class="chip" href="${esc(pm.marked)}" target="_blank" rel="noopener">Open marked image</a>
              <a class="chip" href="${esc(pm.pdf)}" target="_blank" rel="noopener">Valmorel's PDF</a>
            </div>
          </div></details>`
        : `<p class="route-hint">Tap any run or lift for its name, or pick a day for its route.</p>
          <div class="chips zoom-chips" role="group" aria-label="Zoom the map to">
            <button class="chip" data-action="map-fit" data-fit="resort">Resort</button>
            <button class="chip" data-action="map-fit" data-fit="region">Day trips</button>
            <button class="chip" data-action="map-fit" data-fit="all">Airports</button>
          </div>`;
      return;
    }
    const legs = routeText(day);
    const lifts = legs.filter((l) => l.k === 'lift');
    const drags = [...new Set(lifts.filter((l) => l.t === 'drag lift').map((l) => l.n))];
    const liftNote = lifts.length ? (drags.length ? `Needs a drag lift: ${drags.join(', ')}.` : 'No drag lifts.') : '';
    const step = mapState.step;
    const stepper = legs.length ? `<div class="stepper">
        <button class="step-btn" data-action="route-prev" aria-label="Previous step" ${step < 0 ? 'disabled' : ''}>‹</button>
        <div class="step-now" role="status">
          ${step < 0
            ? `<strong>Overview</strong><span class="muted">${esc(plural(legs.length, 'step'))}. ${esc(liftNote)}</span>`
            : `<small class="muted">Step ${step + 1} of ${legs.length}</small><strong>${legTitle(legs[step])}</strong>${legDetail(legs[step])}`}
        </div>
        <button class="step-btn step-next" data-action="route-next" aria-label="Next step" ${step >= legs.length - 1 ? 'disabled' : ''}>›</button>
      </div>` : '';
    const firstWarn = (day.warn || [])[0];
    card.innerHTML = `<div class="route-head">
        <h2>${esc(day.title)}</h2>
        ${day.pass ? '' : '<span class="badge status-todo">No lift pass</span>'}
      </div>
      ${firstWarn ? `<p class="route-warn">${esc(firstWarn)}</p>` : ''}
      ${stepper}
      ${legs.length || day.stops.length ? `<details class="fold"><summary><span class="fold-title">${legs.length ? 'Full plan' : 'Details'}</span></summary><div class="fold-body">
        <p>${esc(day.blurb)}</p>
        ${(day.warn || []).length > 1 ? `<ul class="map-warn">${day.warn.slice(1).map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        ${day.lead ? `<p class="muted">${esc(day.lead)}</p>` : ''}
        ${legs.length ? `<ol class="steps route-steps">${legs.map((leg, i) => `<li><button class="leg" data-action="route-step" data-index="${i}"><strong>${legTitle(leg)}</strong>${legDetail(leg)}</button></li>`).join('')}</ol>` : ''}
        ${day.stops.length ? `<ul class="pay-list">${day.stops.map((s) => `<li><strong>${esc(s.name)}</strong><span class="muted">${esc(s.note)}</span>${mapButton(s.lat, s.lon, s.name)}</li>`).join('')}</ul>` : ''}
        ${legs.length ? '<p class="muted small">A suggested route. Follow the piste signs, and check what is open on the day.</p>' : ''}
      </div></details>` : `<p class="muted">${esc(day.blurb)}</p>`}`;
  }

  function fitMap(which) {
    const home = [resort.lat, resort.lon];
    const pick = (area) => trip.attractions.filter((x) => x.area === area).map((x) => [x.lat, x.lon]);
    const pts = {
      resort: [home, ...pick('resort').filter((p) => p[1] < 6.48)],
      region: [home, ...pick('region')],
      all: [home, ...pick('region'), ...trip.gateways.map((g) => [g.lat, g.lon])],
    }[which];
    map.fitBounds(L.latLngBounds(pts), { padding: [24, 24], maxZoom: 14 });
  }

  function renderMapView() {
    if (!mapState.day) {
      const todays = trip.mapDays.find((m) => m.date === today());
      mapState.day = todays ? todays.id : 'all';
    }
    const chip = (id, label) => `<button class="chip" aria-pressed="${mapState.day === id}" data-action="map-day" data-day="${esc(id)}">${esc(label)}</button>`;
    view.innerHTML = `${segHtml('explore', EXPLORE_VIEWS, 'map')}
      <div class="chips day-chips" role="group" aria-label="Choose a day">
        ${chip('all', 'All places')}${trip.mapDays.map((m) => chip(m.id, m.label)).join('')}
      </div>
      <div class="map-stage">
        <div id="map" class="stage-map"></div>
        <div id="compass" class="compass" role="img"></div>
        <div class="base-switch" role="group" aria-label="Map type">
          <button data-action="map-base" data-base="piste" aria-pressed="${mapState.base === 'piste'}">Piste</button>
          <button data-action="map-base" data-base="street" aria-pressed="${mapState.base === 'street'}">Street</button>
        </div>
      </div>
      <div id="route-card" class="route-card"></div>`;
    mountMap();
  }

  /* ---------- explore ---------- */
  const exploreState = { type: 'All', show: 'all' };
  const TYPES = ['All', ...new Set(trip.attractions.map((a) => a.type))];

  function eveningsHtml() {
    const { evenings } = trip;
    const rows = (items) => `<ul class="pay-list">${items.map((i) => `<li>
      <strong>${esc(i.title)}</strong>
      <span class="muted">${esc(i.detail)}${i.phone ? ` <a href="tel:${esc(i.phone)}">${esc(i.phoneLabel)}</a>` : ''}</span>
      ${i.lat ? mapButton(i.lat, i.lon, i.title) : ''}
    </li>`).join('')}</ul>`;
    return `<h1 class="page-title">Evenings and nights</h1>
      <p class="muted lede">${esc(evenings.note)}</p>
      <div class="folds">
        ${foldHtml('Things to do', rows(evenings.activities), { open: true, extra: '<span class="muted small">Most cost extra</span>' })}
        ${foldHtml('At Club Med', rows(evenings.clubMed), { extra: '<span class="muted small">Included</span>' })}
        ${foldHtml('Getting to the village', `<p class="muted">${esc(evenings.gettingThere)}</p>`)}
        ${foldHtml('Bars and restaurants', rows(evenings.village), { extra: '<span class="muted small">Pay as you go</span>' })}
        ${foldHtml('Probably not on your week', rows(evenings.unlikely))}
      </div>`;
  }

  function renderExplore(sub) {
    const active = EXPLORE_VIEWS.some(([id]) => id === sub) ? sub : 'map';
    if (active === 'map') { renderMapView(); return; }
    const seg = segHtml('explore', EXPLORE_VIEWS, active);
    if (active === 'evenings') {
      view.innerHTML = seg + eveningsHtml();
      return;
    }
    view.innerHTML = `${seg}<h1 class="page-title">Things to do</h1><div id="explore-results"></div>`;
    renderExploreResults();
  }

  function renderExploreResults() {
    const favs = load('favs', []);
    const visited = load('visited', []);
    const list = trip.attractions.filter((a) => {
      if (exploreState.type !== 'All' && a.type !== exploreState.type) return false;
      if (exploreState.show === 'saved') return favs.includes(a.name);
      if (exploreState.show === 'todo') return !visited.includes(a.name);
      return true;
    });
    const chip = (group, value, label, active) => `<button class="chip" aria-pressed="${active}" data-action="explore" data-group="${group}" data-value="${esc(value)}">${esc(label)}</button>`;

    document.getElementById('explore-results').innerHTML = `<p class="muted">${visited.length} of ${trip.attractions.length} done · ${favs.length} saved</p>
      <div class="chips day-chips" role="group" aria-label="Filter by type">
        ${TYPES.map((t) => chip('type', t, t, exploreState.type === t)).join('')}
      </div>
      <div class="chips" role="group" aria-label="Filter by status">
        ${chip('show', 'all', 'All', exploreState.show === 'all')}
        ${chip('show', 'saved', 'Saved', exploreState.show === 'saved')}
        ${chip('show', 'todo', 'Not done', exploreState.show === 'todo')}
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
            <p class="card-badges">
              ${a.pisteNum ? `<span class="badge status-booked">Piste map #${a.pisteNum}</span>` : ''}
              ${PASS_LABEL[a.pass] ? `<span class="badge status-todo">${esc(PASS_LABEL[a.pass])}</span>` : ''}
            </p>
            <div class="card-actions">
              ${mapButton(a.lat, a.lon, a.name, a.pisteNum)}
              <button class="chip" aria-pressed="${fav}" data-action="toggle-list" data-list="favs" data-name="${esc(a.name)}">${fav ? 'Saved' : 'Save'}</button>
              <button class="chip" aria-pressed="${seen}" data-action="toggle-list" data-list="visited" data-name="${esc(a.name)}">${seen ? 'Done' : 'Mark done'}</button>
              <a class="chip" href="${esc(mapsUrl(a.q))}" target="_blank" rel="noopener">Maps</a>
            </div>
          </article>`;
        }).join('') : '<p class="muted">Nothing here with these filters.</p>'}
      </div>`;
  }

  /* ---------- mountain ---------- */
  function renderMountain() {
    const m = trip.mountain;
    view.innerHTML = `<h1 class="page-title">The mountain</h1>

      <section>
        <h2 class="section-title">Last lifts back</h2>
        <ul class="map-warn">${m.lastLifts.map((w) => `<li>${esc(w.text)}${w.lat ? ` ${mapButton(w.lat, w.lon, w.label)}` : ''}</li>`).join('')}</ul>
        <p class="muted small">From the 2025-26 piste map. Times are subject to change.</p>
      </section>

      <section>
        <h2 class="section-title">Check before you ride</h2>
        <p class="muted lede">These open Valmorel's and Météo-France's live pages. For daily routes, open Explore.</p>
        <div class="link-cards">
          ${m.links.map((l) => `<a class="link-card" href="${esc(l.url)}" target="_blank" rel="noopener">
            <strong>${esc(l.title)} <span aria-hidden="true">↗</span></strong>
            <span class="muted">${esc(l.detail)}</span>
          </a>`).join('')}
        </div>
      </section>

      <section>
        <h2 class="section-title">Valmorel on a snowboard</h2>
        <p class="muted lede">From resort guides of varying age. One guest's Tripadvisor review is titled "Snowboarding trip was fantastic", so opinions differ.</p>
        <ul class="pay-list">
          ${m.board.map((l) => `<li><strong>${esc(l.title)}</strong><span class="muted">${esc(l.detail)}</span>${l.lat ? mapButton(l.lat, l.lon, l.title) : ''}</li>`).join('')}
        </ul>
      </section>

      <section>
        <h2 class="section-title">Snowboard tips</h2>
        <ul class="pay-list">
          ${m.tips.map((l) => `<li><strong>${esc(l.title)}</strong><span class="muted">${esc(l.detail)}</span></li>`).join('')}
        </ul>
      </section>

      <section>
        <h2 class="section-title">Piste colours</h2>
        <ul class="piste-colours">
          ${m.colours.map(([color, name, what]) => `<li><i class="piste-dot" style="background:${esc(color)}"></i><strong>${esc(name)}</strong><span class="muted">${esc(what)}</span></li>`).join('')}
        </ul>
      </section>

      <section>
        <h2 class="section-title">How to ride the lifts</h2>
        <p class="muted lede">General snowboarding advice. Your instructor can show you on the first day.</p>
        <ul class="pay-list">
          ${m.lifts.map((l) => `<li><strong>${esc(l.title)}</strong><span class="muted">${esc(l.detail)}</span></li>`).join('')}
        </ul>
      </section>

      <section>
        <h2 class="section-title">If someone is hurt</h2>
        <p class="muted lede">From Valmorel's own accident guidance.</p>
        <ol class="steps">
          ${m.accident.map((s) => `<li><strong>${esc(s.title)}</strong><span class="muted">${esc(s.detail)}</span></li>`).join('')}
        </ol>
      </section>

      <section>
        <h2 class="section-title">Rules of the slopes</h2>
        <p class="muted lede">The 10 international FIS rules, in short.</p>
        <ol class="rules">
          ${m.rules.map(([title, what]) => `<li><strong>${esc(title)}.</strong> <span class="muted">${esc(what)}</span></li>`).join('')}
        </ol>
      </section>`;
  }

  /* ---------- food ---------- */
  const foodState = { show: 'all' };
  const photoUrls = new Map();

  // Photos live in IndexedDB because they are too big for localStorage.
  function photoStore(mode, work) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('carnet-photos', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('photos');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('photos', mode);
        const request = work(tx.objectStore('photos'));
        tx.oncomplete = () => { db.close(); resolve(request && request.result); };
        tx.onerror = () => { db.close(); reject(tx.error); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }
  const savePhoto = (id, blob) => photoStore('readwrite', (store) => store.put(blob, id));
  const readPhoto = (id) => photoStore('readonly', (store) => store.get(id));
  const erasePhoto = (id) => photoStore('readwrite', (store) => store.delete(id));

  function shrinkPhoto(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
      image.onload = () => {
        // Small enough to fit in one Firestore document when shared.
        const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.naturalWidth * scale);
        canvas.height = Math.round(image.naturalHeight * scale);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        const encode = (quality) => canvas.toBlob((blob) => {
          if (!blob) reject(new Error('Could not process that image'));
          else if (blob.size > 650000 && quality > 0.45) encode(quality - 0.15);
          else resolve(blob);
        }, 'image/jpeg', quality);
        encode(0.78);
      };
      image.src = url;
    });
  }

  const allFood = () => [...trip.food, ...load('customFood', [])];
  const foodEntry = (id) => load('foodLog', {})[id] || {};
  function updateFood(id, changes) {
    const log = load('foodLog', {});
    log[id] = { ...log[id], ...changes };
    save('foodLog', log);
  }

  // Ratings and notes are per person, so both of you can rate the same dish.
  // Photos are a map of id to time added, so two phones can add at once.
  const photoIds = (entry) => {
    const p = entry.photos;
    if (Array.isArray(p)) return p;
    return Object.keys(p || {}).sort((x, y) => p[x] - p[y]);
  };
  const myRating = (entry) => (entry.ratings || {})[meId()] || 0;
  const myNote = (entry) => (entry.notes || {})[meId()] || '';
  const ratingsOf = (entry) => Object.values(entry.ratings || {}).filter((n) => n > 0);
  const averageOf = (entry) => {
    const r = ratingsOf(entry);
    return r.length ? r.reduce((sum, n) => sum + n, 0) / r.length : 0;
  };

  function migrateFood() {
    const log = load('foodLog', {});
    let changed = false;
    Object.values(log).forEach((entry) => {
      if ('rating' in entry) {
        if (entry.rating > 0) entry.ratings = { ...entry.ratings, [meId()]: entry.rating };
        delete entry.rating;
        changed = true;
      }
      if ('note' in entry) {
        if (entry.note) entry.notes = { ...entry.notes, [meId()]: entry.note };
        delete entry.note;
        changed = true;
      }
      if (Array.isArray(entry.photos)) {
        entry.photos = Object.fromEntries(entry.photos.map((id, i) => [id, i + 1]));
        changed = true;
      }
    });
    if (changed) save('foodLog', log);
  }

  // Carry over ticks from the old checklist in Explore.
  function migrateTried() {
    const old = load('tried', null);
    if (!old) return;
    const log = load('foodLog', {});
    old.forEach((id) => { log[id] = { ...log[id], tried: true }; });
    save('foodLog', log);
    try { localStorage.removeItem(storeKey('tried')); } catch (err) { /* storage blocked */ }
  }

  function othersHtml(entry) {
    const me = meId();
    const ids = [...new Set([...Object.keys(entry.ratings || {}), ...Object.keys(entry.notes || {})])].filter((id) => id !== me);
    const lines = ids.map((id) => {
      const r = (entry.ratings || {})[id] || 0;
      const note = (entry.notes || {})[id] || '';
      if (!r && !note) return '';
      return `<li><strong>${esc(personName(id))}</strong>${r ? ` <span class="stars-small" aria-label="${plural(r, 'star')}">${'★'.repeat(r)}</span>` : ''}${note ? `<br><span class="muted">${esc(note)}</span>` : ''}</li>`;
    }).filter(Boolean);
    return lines.length ? `<ul class="food-others">${lines.join('')}</ul>` : '';
  }

  function foodCardHtml(f) {
    const entry = foodEntry(f.id);
    const rating = myRating(entry);
    return `<article class="food-card ${entry.tried ? 'is-tried' : ''}" data-food="${esc(f.id)}">
      <h2>${esc(f.name)}</h2>
      ${f.what ? `<p class="muted">${esc(f.what)}</p>` : ''}
      <div class="food-rate">
        <div class="stars" role="group" aria-label="Rate ${esc(f.name)}">
          ${[1, 2, 3, 4, 5].map((n) => `<button class="star ${n <= rating ? 'on' : ''}" data-action="food-rate" data-id="${esc(f.id)}" data-value="${n}" aria-pressed="${n === rating}" aria-label="${plural(n, 'star')}">★</button>`).join('')}
        </div>
        <button class="chip" aria-pressed="${Boolean(entry.tried)}" data-action="food-tried" data-id="${esc(f.id)}">${entry.tried ? 'Tried' : 'Mark tried'}</button>
      </div>
      <label class="sr-only" for="note-${esc(f.id)}">Note about ${esc(f.name)}</label>
      <textarea id="note-${esc(f.id)}" class="food-note" data-action="food-note" data-id="${esc(f.id)}" rows="2" placeholder="Where you had it, what you thought…">${esc(myNote(entry))}</textarea>
      ${othersHtml(entry)}
      <div class="food-photos" data-photos="${esc(f.id)}"></div>
      <div class="card-actions">
        <label class="chip photo-add">
          <input class="sr-only" type="file" accept="image/*" multiple data-action="food-photo" data-id="${esc(f.id)}">
          Add photo
        </label>
        ${f.custom ? `<button class="chip" data-action="food-remove" data-id="${esc(f.id)}">Remove</button>` : ''}
      </div>
      <p class="muted small food-status" role="status"></p>
    </article>`;
  }

  async function showFoodPhotos(id) {
    const holder = view.querySelector(`[data-photos="${CSS.escape(id)}"]`);
    if (!holder) return;
    const name = (allFood().find((f) => f.id === id) || {}).name || 'this dish';
    const ids = photoIds(foodEntry(id));
    let missing = 0;
    const urls = await Promise.all(ids.map(async (photoId) => {
      if (photoUrls.has(photoId)) return [photoId, photoUrls.get(photoId)];
      try {
        let blob = await readPhoto(photoId);
        if (!blob && sync.active) {
          blob = await sync.getPhoto(photoId);
          if (blob) await savePhoto(photoId, blob).catch(() => {});
        }
        if (!blob) { missing += 1; return null; }
        const url = URL.createObjectURL(blob);
        photoUrls.set(photoId, url);
        return [photoId, url];
      } catch (err) { return null; }
    }));
    // The card may have been redrawn while photos loaded.
    const live = view.querySelector(`[data-photos="${CSS.escape(id)}"]`);
    if (!live) return;
    live.innerHTML = urls.filter(Boolean).map(([photoId, url]) => `<button class="food-thumb" data-action="food-view" data-id="${esc(id)}" data-photo="${esc(photoId)}" aria-label="View photo of ${esc(name)}"><img src="${esc(url)}" alt=""></button>`).join('')
      + (missing && sync.active ? `<span class="food-thumb is-waiting">${plural(missing, 'photo')} on the way</span>` : '');
    if (missing && sync.active && (photoRetries.get(id) || 0) < 4) {
      photoRetries.set(id, (photoRetries.get(id) || 0) + 1);
      setTimeout(() => showFoodPhotos(id), 8000);
    }
  }
  const photoRetries = new Map();

  function foodSummary() {
    const log = load('foodLog', {});
    const foods = allFood();
    const tried = foods.filter((f) => (log[f.id] || {}).tried).length;
    const ratings = foods.flatMap((f) => ratingsOf(log[f.id] || {}));
    const average = ratings.length ? ` · average ${(ratings.reduce((sum, n) => sum + n, 0) / ratings.length).toFixed(1)} ★` : '';
    return `${tried} of ${foods.length} tried${average}`;
  }

  function renderFoodList() {
    const log = load('foodLog', {});
    const list = allFood().filter((f) => {
      const entry = log[f.id] || {};
      if (foodState.show === 'todo') return !entry.tried;
      if (foodState.show === 'tried') return entry.tried;
      return true;
    });
    if (foodState.show === 'best') list.sort((x, y) => averageOf(log[y.id] || {}) - averageOf(log[x.id] || {}));
    document.getElementById('food-summary').textContent = foodSummary();
    document.querySelectorAll('[data-action="food-filter"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === foodState.show)));
    document.getElementById('food-list').innerHTML = list.length
      ? list.map(foodCardHtml).join('')
      : '<p class="muted">Nothing here yet.</p>';
    list.forEach((f) => showFoodPhotos(f.id));
  }

  function refreshFoodCard(id) {
    const card = view.querySelector(`[data-food="${CSS.escape(id)}"]`);
    const food = allFood().find((f) => f.id === id);
    document.getElementById('food-summary').textContent = foodSummary();
    if (!card || !food) return;
    card.outerHTML = foodCardHtml(food);
    showFoodPhotos(id);
  }

  function renderFood() {
    migrateTried();
    migrateFood();
    const filter = (value, label) => `<button class="chip" aria-pressed="${foodState.show === value}" data-action="food-filter" data-value="${value}">${label}</button>`;
    view.innerHTML = `<h1 class="page-title">Food</h1>
      <p class="muted lede"><strong id="food-summary"></strong><br>${sharing()
        ? 'Ratings, notes and photos are shared with your group. Photos are saved smaller, so keep your originals in your gallery.'
        : `Ratings, notes and photos stay on this phone only, so keep your originals in your gallery too.${sync.configured ? ' <a href="#info/money">Share with your group</a>.' : ''}`}</p>
      <div class="chips" role="group" aria-label="Show">
        ${filter('all', 'All')}${filter('todo', 'To try')}${filter('tried', 'Tried')}${filter('best', 'Top rated')}
      </div>
      <div id="food-list" class="food-list"></div>
      <section>
        <h2 class="section-title">Add something you ate</h2>
        <form class="inline-form" data-form="food">
          <label class="sr-only" for="food-name">What was it?</label>
          <input id="food-name" name="name" placeholder="e.g. Croziflette" autocomplete="off" required>
          <button class="btn" type="submit">Add</button>
        </form>
      </section>
      <dialog id="photo-viewer" class="photo-viewer">
        <img id="photo-viewer-img" alt="">
        <div class="card-actions">
          <button class="chip" data-action="food-photo-close">Close</button>
          <button class="chip" data-action="food-photo-delete">Remove photo</button>
        </div>
      </dialog>`;
    renderFoodList();
  }

  async function addFoodPhotos(input) {
    const { id } = input.dataset;
    const files = [...input.files];
    const card = view.querySelector(`[data-food="${CSS.escape(id)}"]`);
    const status = card && card.querySelector('.food-status');
    if (status) status.textContent = 'Saving…';
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    let failed = 0;
    for (const file of files) {
      try {
        const blob = await shrinkPhoto(file);
        const photoId = `p${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
        await savePhoto(photoId, blob);
        updateFood(id, { photos: { ...foodEntry(id).photos, [photoId]: Date.now() }, tried: true });
        sync.putPhoto(photoId, blob, id);
      } catch (err) { failed += 1; }
    }
    refreshFoodCard(id);
    if (failed) {
      const after = view.querySelector(`[data-food="${CSS.escape(id)}"] .food-status`);
      if (after) after.textContent = `${plural(failed, 'photo')} could not be saved. Your phone may be low on space, or the format may not be supported.`;
    }
  }

  const viewer = { id: null, photo: null };

  /* ---------- money ---------- */
  const euro = (n) => `€${(Math.round(n * 100) / 100).toFixed(2)}`;
  const RATE_URL = 'https://api.frankfurter.dev/v1/latest?base=EUR&symbols=ILS';
  let rate = load('rate', null);

  async function loadRate() {
    if (rate && Date.now() - rate.fetched < 12 * 3600000) return;
    try {
      const res = await fetch(RATE_URL);
      if (!res.ok) throw new Error(res.status);
      const json = await res.json();
      if (!json.rates || !json.rates.ILS) throw new Error('no rate');
      rate = { ils: json.rates.ILS, date: json.date, fetched: Date.now() };
      save('rate', rate);
      if (parseRoute().sub === 'money') refreshInfo('money');
    } catch (e) { /* keep the last rate */ }
  }
  const shekels = (eur) => (rate ? `₪${Math.round(eur * rate.ils).toLocaleString('en-GB')}` : '');

  // Older versions saved { what, amount } with no payer.
  function migrateData() {
    const spend = load('spend', []);
    if (spend.some((e) => !e.id)) {
      save('spend', spend.map((e, i) => (e.id ? e : {
        id: newId('e'), what: e.what, amount: e.amount, cur: 'EUR', eur: e.amount, paidBy: null, split: [], at: i + 1,
      })));
    }
    const refs = load('refs', []);
    if (refs.some((r) => !r.id)) save('refs', refs.map((r, i) => (r.id ? r : { ...r, id: newId('r'), at: i + 1 })));
  }

  const isSplit = (e, ids) => e.paidBy && ids.includes(e.paidBy) && (e.split || []).some((id) => ids.includes(id));

  // Positive means the group owes this person money.
  function balances(spend, ids) {
    const bal = Object.fromEntries(ids.map((id) => [id, 0]));
    spend.forEach((e) => {
      if (!isSplit(e, ids)) return;
      const split = e.split.filter((id) => ids.includes(id));
      bal[e.paidBy] += e.eur;
      split.forEach((id) => { bal[id] -= e.eur / split.length; });
    });
    return bal;
  }

  // The fewest payments that clear everyone's balance.
  function settleUp(bal) {
    const owes = Object.entries(bal).filter(([, v]) => v < -0.005).map(([id, v]) => [id, -v]).sort((a, b) => b[1] - a[1]);
    const owed = Object.entries(bal).filter(([, v]) => v > 0.005).map(([id, v]) => [id, v]).sort((a, b) => b[1] - a[1]);
    const out = [];
    let i = 0;
    let j = 0;
    while (i < owes.length && j < owed.length) {
      const amount = Math.min(owes[i][1], owed[j][1]);
      out.push({ from: owes[i][0], to: owed[j][0], amount: Math.round(amount * 100) / 100 });
      owes[i][1] -= amount;
      owed[j][1] -= amount;
      if (owes[i][1] < 0.005) i += 1;
      if (owed[j][1] < 0.005) j += 1;
    }
    return out.filter((t) => t.amount >= 0.01);
  }

  const syncStatusHtml = () => {
    const { state, text } = sync.status;
    return `<p class="sync-status is-${esc(state)}" data-sync-status role="status"><span class="sync-dot" aria-hidden="true"></span><span>${esc(text || 'Connecting…')}</span></p>`;
  };

  function showSyncStatus() {
    document.querySelectorAll('[data-sync-status]').forEach((el) => { el.outerHTML = syncStatusHtml(); });
  }

  function sharingHtml() {
    const me = load('me', null);
    const ppl = people();
    if (!sync.configured) {
      return `<section class="panel">
        <h2 class="section-title">Sharing</h2>
        <p class="muted">Sharing between phones isn't switched on for this site yet, so everything here is saved on this phone only.</p>
      </section>`;
    }
    if (!sharing()) {
      return `<section class="panel">
        <h2 class="section-title">Share with your group</h2>
        <p>Keep money, to-dos, packing, food ratings and photos, journal notes and booking references in sync on all your phones. It works offline and catches up when you have signal.</p>
        <form class="inline-form" data-form="share-start">
          ${me && ppl.some((p) => p.id === me) ? '' : `<label class="sr-only" for="share-name">Your name</label>
          <input id="share-name" name="name" placeholder="Your name" autocomplete="given-name" required>`}
          <button class="btn" type="submit">Start sharing</button>
        </form>
        <p class="muted small" id="share-msg" role="status"></p>
        <p class="muted small">Got an invite link from someone? Open it, or paste it here.</p>
        <form class="inline-form" data-form="join-paste">
          <label class="sr-only" for="join-link">Invite link</label>
          <input id="join-link" name="link" placeholder="Paste an invite link" autocomplete="off" required>
          <button class="btn btn-quiet" type="submit">Join</button>
        </form>
      </section>`;
    }
    const known = me && ppl.some((p) => p.id === me);
    return `<section class="panel">
      <h2 class="section-title">Shared trip</h2>
      ${syncStatusHtml()}
      ${known ? '' : `<div class="who">
        <p><strong>Which one is you?</strong> This sets whose name goes on your ratings and payments.</p>
        <div class="chips">${ppl.map((p) => `<button class="chip" data-action="set-me" data-id="${esc(p.id)}">${esc(p.name)}</button>`).join('')}</div>
        <form class="inline-form" data-form="person" data-me="1">
          <label class="sr-only" for="me-name">I'm not listed. My name</label>
          <input id="me-name" name="name" placeholder="I'm not listed. My name" autocomplete="given-name" required>
          <button class="btn" type="submit">Add me</button>
        </form>
      </div>`}
      <p>Send this link to the others on the trip. Opening it adds their phone.</p>
      <div class="card-actions">
        ${navigator.share ? '<button class="btn" data-action="share-invite">Send invite</button>' : ''}
        <button class="btn btn-quiet" data-action="share-copy">Copy invite link</button>
      </div>
      <p class="muted small" id="share-msg" role="status"></p>
      <details class="fold-lite">
        <summary>More</summary>
        <p class="muted small">Anyone with the link can join, so only send it to the people on the trip. Keep it in your chat too: if a phone gets reset, opening it again brings everything back.</p>
        <button class="btn btn-quiet" data-action="share-leave">Stop sharing on this phone</button>
      </details>
    </section>`;
  }

  function expenseLine(e, ids) {
    const when = e.at > 1e11 ? new Date(e.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
    let who = 'Not split';
    if (e.kind === 'settle') who = `${esc(personName(e.paidBy))} paid ${esc(personName((e.split || [])[0]))} back`;
    else if (isSplit(e, ids)) {
      const split = e.split.filter((id) => ids.includes(id));
      const forWho = split.length === ids.length && ids.length > 1 ? `split ${split.length} ways`
        : split.length === 1 ? `for ${esc(personName(split[0]))}` : `split between ${split.map((id) => esc(personName(id))).join(', ')}`;
      who = `${esc(personName(e.paidBy))} paid, ${forWho}`;
    } else if (e.paidBy) who = `${esc(personName(e.paidBy))} paid`;
    const amount = e.cur === 'ILS' ? `₪${e.amount.toFixed(2)} <span class="muted">(${euro(e.eur)})</span>` : euro(e.eur);
    return `<li class="${e.kind === 'settle' ? 'is-settle' : ''}">
      <span><strong>${esc(e.what)}</strong> · ${amount}<br><span class="muted small">${who}${when ? ` · ${when}` : ''}</span></span>
      <button class="chip" data-action="del-expense" data-id="${esc(e.id)}" aria-label="Remove ${esc(e.what)}">Remove</button>
    </li>`;
  }

  function renderMoney() {
    loadRate();
    const ppl = people();
    const ids = ppl.map((p) => p.id);
    const me = load('me', null);
    const spend = load('spend', []);
    const real = spend.filter((e) => e.kind !== 'settle');
    const total = real.reduce((sum, e) => sum + e.eur, 0);
    const bal = balances(spend, ids);
    const debts = settleUp(bal);
    const paid = (id) => real.filter((e) => e.paidBy === id).reduce((sum, e) => sum + e.eur, 0);
    const defaultPayer = ids.includes(me) ? me : ids[0];

    view.innerHTML = `<h1 class="page-title">Money</h1>
      <p class="muted lede">Rental, lessons on top, spa, drinks and anything else Club Med doesn't include.${rate ? ` €1 ≈ ₪${rate.ils.toFixed(2)} (ECB rate, ${esc(shortDate(rate.date))}).` : ''}</p>
      ${sync.configured && !sharing() ? sharingHtml() : ''}

      <section class="money-top">
        <p class="money-total"><span class="muted small">Spent so far</span><strong>${euro(total)}</strong>${rate && total ? `<span class="muted">≈ ${shekels(total)}</span>` : ''}</p>
        ${ppl.length > 1 ? `<ul class="money-people">
          ${ppl.map((p) => `<li><strong>${esc(p.name)}${p.id === me ? ' (you)' : ''}</strong><span>paid ${euro(paid(p.id))}</span></li>`).join('')}
        </ul>` : ''}
      </section>

      ${ppl.length > 1 ? `<section>
        <h2 class="section-title">Settle up</h2>
        ${debts.length ? `<ul class="refs">${debts.map((d) => `<li>
          <span><strong>${esc(personName(d.from))}</strong> owes <strong>${esc(personName(d.to))}</strong> ${euro(d.amount)}${rate ? ` <span class="muted">(≈ ${shekels(d.amount)})</span>` : ''}</span>
          <button class="chip" data-action="settle" data-from="${esc(d.from)}" data-to="${esc(d.to)}" data-amount="${d.amount}">Mark paid back</button>
        </li>`).join('')}</ul>` : '<p class="muted">All square.</p>'}
      </section>` : ''}

      <section>
        <h2 class="section-title">Add an expense</h2>
        <form class="money-form" data-form="expense">
          <div class="inline-form">
            <label class="sr-only" for="ex-what">What it was for</label>
            <input id="ex-what" name="what" placeholder="e.g. Board rental" autocomplete="off" required>
          </div>
          <div class="inline-form">
            <label class="sr-only" for="ex-amount">Amount</label>
            <input id="ex-amount" name="amount" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="Amount" required>
            <label class="sr-only" for="ex-cur">Currency</label>
            <select id="ex-cur" name="cur">
              <option value="EUR">€ EUR</option>
              <option value="ILS" ${rate ? '' : 'disabled'}>₪ ILS${rate ? '' : ' (needs signal once)'}</option>
            </select>
          </div>
          ${ppl.length > 1 ? `<div class="money-field">
            <label for="ex-payer">Paid by</label>
            <select id="ex-payer" name="paidBy">${ppl.map((p) => `<option value="${esc(p.id)}" ${p.id === defaultPayer ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
          </div>
          <fieldset class="money-field">
            <legend>Split between</legend>
            <div class="chips">${ppl.map((p) => `<label class="check chip-check"><input type="checkbox" name="split" value="${esc(p.id)}" checked><span>${esc(p.name)}</span></label>`).join('')}</div>
          </fieldset>` : ''}
          <button class="btn" type="submit">Add</button>
          <p class="muted small" id="expense-msg" role="status"></p>
        </form>
      </section>

      <section>
        <h2 class="section-title">Expenses <span class="muted small">${plural(real.length, 'item')}</span></h2>
        ${spend.length ? `<ul class="refs">${spend.slice().reverse().map((e) => expenseLine(e, ids)).join('')}</ul>` : '<p class="muted">Nothing logged yet.</p>'}
      </section>

      <section>
        <h2 class="section-title">Who's on the trip</h2>
        <p class="muted">Add everyone who shares costs, so you can split them.</p>
        ${ppl.length ? `<ul class="refs">${ppl.map((p) => `<li>
          <span><strong>${esc(p.name)}</strong>${p.id === me ? ' <span class="muted">(you)</span>' : ''}</span>
          <span class="card-actions">
            ${!me || !ids.includes(me) ? `<button class="chip" data-action="set-me" data-id="${esc(p.id)}">This is me</button>` : ''}
            <button class="chip" data-action="del-person" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">Remove</button>
          </span>
        </li>`).join('')}</ul>` : ''}
        <form class="inline-form" data-form="person" ${ids.includes(me) ? '' : 'data-me="1"'}>
          <label class="sr-only" for="person-name">${ids.includes(me) ? 'Name' : 'Your name'}</label>
          <input id="person-name" name="name" placeholder="${ids.includes(me) ? 'Add someone' : 'Your name'}" autocomplete="off" required>
          <button class="btn" type="submit">Add</button>
        </form>
      </section>

      ${sync.configured && !sharing() ? '' : sharingHtml()}`;
  }

  function refreshInfo(sub) {
    const y = window.scrollY;
    renderInfo(sub);
    window.scrollTo({ top: y, behavior: 'instant' });
  }

  async function startSharing(form) {
    const msg = document.getElementById('share-msg');
    const name = form.elements.name ? String(form.elements.name.value).trim() : '';
    if (form.elements.name && !name) return;
    const button = form.querySelector('button');
    button.disabled = true;
    msg.textContent = 'Setting up…';
    try {
      if (name) {
        const id = newId('p');
        save('people', [...people(), { id, name, at: Date.now() }]);
        setMe(id);
      }
      await sync.create();
      refreshInfo('money');
    } catch (err) {
      button.disabled = false;
      msg.textContent = err.message;
    }
  }

  async function shareInvite(copyOnly) {
    const msg = document.getElementById('share-msg');
    const url = sync.inviteLink();
    if (!copyOnly && navigator.share) {
      try { await navigator.share({ title: 'Valmorel 2027', text: 'Join our trip in Carnet de France', url }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(url);
      msg.textContent = 'Invite link copied.';
    } catch (e) {
      msg.innerHTML = `Copy this link: <code class="invite">${esc(url)}</code>`;
    }
  }

  /* ---------- joining ---------- */
  function renderJoin(id) {
    if (!sync.configured) {
      view.innerHTML = `<h1 class="page-title">Join the trip</h1>
        <p>Sharing isn't switched on for this site yet, so this link can't be used.</p>
        <a class="btn" href="#home">Go to Home</a>`;
      return;
    }
    if (sync.tripId === id) {
      view.innerHTML = `<h1 class="page-title">You're in</h1>
        <p>This phone is already part of the shared trip.</p>
        <a class="btn" href="#info/money">Open Money</a>`;
      return;
    }
    view.innerHTML = `<h1 class="page-title">Join the trip</h1>
      <p class="lede">Someone shared their Valmorel trip with you. Joining keeps money, to-dos, packing, food ratings and photos, journal notes and booking references in sync between your phones.</p>
      <p>Anything you've already saved on this phone is added to the shared trip.</p>
      ${sync.tripId ? '<p><strong>This phone is sharing a different trip.</strong> Joining this one stops syncing the other.</p>' : ''}
      <button class="btn" data-action="join-trip" data-id="${esc(id)}">Join</button>
      <p class="muted small" id="join-msg" role="status"></p>
      <p class="muted small">On iPhone, the Home Screen version of the site keeps its own data. If you use it from your Home Screen, open it there and paste this link in Info, then Money.</p>`;
  }

  async function joinTrip(button) {
    const msg = document.getElementById('join-msg');
    button.disabled = true;
    msg.textContent = 'Joining…';
    try {
      await sync.join(button.dataset.id);
      location.hash = '#info/money';
    } catch (err) {
      button.disabled = false;
      msg.textContent = err.message;
    }
  }

  /* ---------- live updates from other phones ---------- */
  let refreshWaiting = false;
  function busyEditing() {
    const el = document.activeElement;
    const typing = el && view.contains(el) && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'file', 'button', 'submit'].includes(el.type)));
    return Boolean(typing || view.querySelector('dialog[open]'));
  }

  // Redraw the current page with the new data, keeping the scroll position
  // and any open sections. Waits while you're typing, and skips the map.
  function refreshAfterSync() {
    if (document.body.classList.contains('is-map')) return;
    if (busyEditing()) { refreshWaiting = true; return; }
    refreshWaiting = false;
    const y = window.scrollY;
    const open = [...view.querySelectorAll('details')].map((d) => d.open);
    route();
    const now = [...view.querySelectorAll('details')];
    if (now.length === open.length) now.forEach((d, i) => { d.open = open[i]; });
    window.scrollTo({ top: y, behavior: 'instant' });
  }
  const refreshIfWaiting = () => setTimeout(() => { if (refreshWaiting && !busyEditing()) refreshAfterSync(); }, 250);

  /* ---------- kit ---------- */
  const EMERGENCY = [
    ['112', 'Any emergency, from anywhere in the EU'],
    ['15', 'Medical (SAMU)'],
    ['17', 'Police'],
    ['18', 'Fire'],
    ['114', 'Emergency by text, for deaf or hard-of-hearing callers'],
  ];

  const LOCAL_NUMBERS = [
    ['Slope rescue and lifts', '+33 4 79 09 80 26', '+33479098026'],
    ['Medical centre', '+33 7 67 25 18 19', '+33767251819'],
    ['Tourist office', '+33 4 79 09 85 55', '+33479098555'],
    ['ESF ski and snowboard school', '+33 4 79 09 81 86', '+33479098186'],
    ['Local police', '+33 4 79 09 49 30', '+33479094930'],
    ['Gendarmerie', '+33 4 79 09 80 95', '+33479098095'],
  ];

  function renderKit() {
    const checked = load('packed', []);
    const extras = load('packExtras', []);
    const groups = { ...trip.packing, ...(extras.length ? { 'Your additions': extras } : {}) };
    const allItems = Object.values(groups).flat();
    const done = allItems.filter((i) => checked.includes(i)).length;
    const refs = load('refs', []);
    const canSpeak = 'speechSynthesis' in window;

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
        <p class="muted">${sharing() ? 'Shared with your group and never put on the public site.' : `Saved only on this phone, so they stay off the public site.${sync.configured ? ' Turn on sharing in Money to have them on every phone.' : " You'd need to add them on each phone."}`}</p>
        <ul class="refs">
          ${refs.map((r) => `<li>
            <span><strong>${esc(r.label)}</strong><br><code>${esc(r.value)}</code></span>
            <button class="chip" data-action="del-ref" data-id="${esc(r.id)}" aria-label="Remove ${esc(r.label)}">Remove</button>
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
        <p class="muted lede">On the slopes, first call the number printed on your lift pass. It reaches slope rescue directly.</p>
        <ul class="emergency">
          ${EMERGENCY.map(([num, what]) => `<li><a class="em-num" href="${num === '114' ? 'sms' : 'tel'}:${num}">${num}</a><span>${esc(what)}</span></li>`).join('')}
        </ul>
      </section>

      <section>
        <h2 class="section-title">Local numbers</h2>
        <ul class="pay-list local-numbers">
          ${LOCAL_NUMBERS.map(([what, shown, tel]) => `<li><strong>${esc(what)}</strong><a href="tel:${esc(tel)}">${esc(shown)}</a></li>`).join('')}
        </ul>
        <p class="muted small">From Valmorel's 2025-26 guides, so they may change.</p>
      </section>

      <section>
        <h2 class="section-title">Useful French</h2>
        <dl class="phrases">
          ${trip.phrases.map(([en, fr, say]) => `<div>
            <dt>${esc(en)}</dt>
            <dd lang="fr"><strong>${esc(fr)}</strong></dd>
            <dd class="muted">${esc(say)}</dd>
            ${canSpeak ? `<dd><button class="chip say" data-action="say" data-text="${esc(fr)}" aria-label="Hear ${esc(fr)}">▶ Hear it</button></dd>` : ''}
          </div>`).join('')}
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
    renderInfo('kit');
    window.scrollTo({ top: y, behavior: 'instant' });
  }

  function speakFrench(text) {
    const speech = window.speechSynthesis;
    speech.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'fr-FR';
    utterance.rate = 0.9;
    const voice = speech.getVoices().find((v) => v.lang.toLowerCase().startsWith('fr'));
    if (voice) utterance.voice = voice;
    speech.speak(utterance);
  }

  /* ---------- events ---------- */
  view.addEventListener('input', (event) => {
    const el = event.target;
    if (el.dataset.action === 'food-note') {
      updateFood(el.dataset.id, { notes: { ...foodEntry(el.dataset.id).notes, [meId()]: el.value } });
      return;
    }
    if (el.dataset.action !== 'journal') return;
    const journal = load('journal', {});
    const entry = { ...journal[el.dataset.date], [el.dataset.field]: el.value };
    save('journal', { ...journal, [el.dataset.date]: entry });
    const mark = view.querySelector(`[data-journal-mark="${el.dataset.date}"]`);
    if (mark) mark.textContent = Object.values(entry).some(Boolean) ? ' · has notes' : '';
  });

  view.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    if (!el) return;
    const { action } = el.dataset;
    if (action === 'jump-today') {
      const target = document.getElementById(`day-${today()}`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (action === 'food-filter') {
      foodState.show = el.dataset.value;
      renderFoodList();
    } else if (action === 'food-rate') {
      const value = Number(el.dataset.value);
      const entry = foodEntry(el.dataset.id);
      const ratings = { ...entry.ratings };
      const clear = value === myRating(entry);
      if (clear) delete ratings[meId()];
      else ratings[meId()] = value;
      updateFood(el.dataset.id, clear ? { ratings } : { ratings, tried: true });
      refreshFoodCard(el.dataset.id);
    } else if (action === 'food-tried') {
      updateFood(el.dataset.id, { tried: !foodEntry(el.dataset.id).tried });
      refreshFoodCard(el.dataset.id);
    } else if (action === 'food-view') {
      viewer.id = el.dataset.id;
      viewer.photo = el.dataset.photo;
      document.getElementById('photo-viewer-img').src = photoUrls.get(el.dataset.photo) || '';
      document.getElementById('photo-viewer').showModal();
    } else if (action === 'food-photo-close') {
      document.getElementById('photo-viewer').close();
    } else if (action === 'food-photo-delete') {
      const { id, photo } = viewer;
      document.getElementById('photo-viewer').close();
      const left = { ...foodEntry(id).photos };
      delete left[photo];
      updateFood(id, { photos: left });
      erasePhoto(photo).catch(() => {});
      sync.deletePhoto(photo);
      if (photoUrls.has(photo)) { URL.revokeObjectURL(photoUrls.get(photo)); photoUrls.delete(photo); }
      refreshFoodCard(id);
    } else if (action === 'food-remove') {
      if (!window.confirm('Remove this dish, with its rating, note and photos?')) return;
      const { id } = el.dataset;
      photoIds(foodEntry(id)).forEach((p) => { erasePhoto(p).catch(() => {}); sync.deletePhoto(p); });
      const log = load('foodLog', {});
      delete log[id];
      save('foodLog', log);
      save('customFood', load('customFood', []).filter((f) => f.id !== id));
      renderFoodList();
    } else if (action === 'calendar') {
      downloadCalendar();
    } else if (action === 'copy-journal') {
      copyJournal();
    } else if (action === 'say') {
      speakFrench(el.dataset.text);
    } else if (action === 'del-expense') {
      const item = load('spend', []).find((e) => e.id === el.dataset.id);
      if (!item || !window.confirm(`Remove "${item.what}"?`)) return;
      save('spend', load('spend', []).filter((e) => e.id !== el.dataset.id));
      refreshInfo('money');
    } else if (action === 'settle') {
      const amount = Number(el.dataset.amount);
      save('spend', [...load('spend', []), {
        id: newId('e'), what: 'Paid back', kind: 'settle', amount, cur: 'EUR', eur: amount,
        paidBy: el.dataset.from, split: [el.dataset.to], at: Date.now(), by: meId(),
      }]);
      refreshInfo('money');
    } else if (action === 'set-me') {
      setMe(el.dataset.id);
      refreshInfo('money');
    } else if (action === 'del-person') {
      const used = load('spend', []).some((e) => e.paidBy === el.dataset.id || (e.split || []).includes(el.dataset.id));
      if (used) { window.alert('This person is on some expenses. Remove those first.'); return; }
      if (!window.confirm(`Remove ${personName(el.dataset.id)}?`)) return;
      save('people', people().filter((p) => p.id !== el.dataset.id));
      if (load('me', null) === el.dataset.id) save('me', null);
      refreshInfo('money');
    } else if (action === 'share-invite' || action === 'share-copy') {
      shareInvite(action === 'share-copy');
    } else if (action === 'share-leave') {
      if (!window.confirm('Stop sharing on this phone? Everything stays saved here, but stops syncing. You can rejoin with the invite link.')) return;
      sync.leave();
      refreshInfo('money');
    } else if (action === 'join-trip') {
      joinTrip(el);
    } else if (action === 'jump-lessons') {
      document.getElementById('lessons').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (action === 'piste-focus') {
      const marker = pisteMarkers.get(Number(el.dataset.num));
      if (marker) {
        map.setView(marker.getLatLng(), -0.5);
        marker.openPopup();
      }
    } else if (action === 'map-day') {
      const id = el.dataset.day;
      mapState.day = id;
      mapState.step = -1;
      const day = currentMapDay();
      if (day && !day.route) mapState.base = 'street';
      updateMapControls();
      if (mapState.base !== builtBase) mountMap();
      else drawDay();
    } else if (action === 'map-base') {
      mapState.base = el.dataset.base;
      mapState.step = -1;
      mountMap();
    } else if (action === 'route-next') {
      setStep(mapState.step + 1);
    } else if (action === 'route-prev') {
      setStep(mapState.step - 1);
    } else if (action === 'route-step') {
      setStep(Number(el.dataset.index));
    } else if (action === 'map-this-day') {
      openMapDay(el.dataset.date);
    } else if (action === 'go-map') {
      goToMap(Number(el.dataset.lat), Number(el.dataset.lon), el.dataset.label, Number(el.dataset.num) || 0);
    } else if (action === 'map-fit') {
      fitMap(el.dataset.fit);
    } else if (action === 'explore') {
      exploreState[el.dataset.group] = el.dataset.value;
      renderExploreResults();
    } else if (action === 'toggle-list') {
      const list = load(el.dataset.list, []);
      save(el.dataset.list, toggled(list, el.dataset.name, !list.includes(el.dataset.name)));
      renderExploreResults();
    } else if (action === 'del-ref') {
      save('refs', load('refs', []).filter((r) => r.id !== el.dataset.id));
      refreshKit();
    }
  });

  view.addEventListener('change', (event) => {
    const el = event.target;
    if (el.dataset.action === 'toggle-pack') {
      save('packed', toggled(load('packed', []), el.dataset.name, el.checked));
      refreshKit();
    } else if (el.dataset.action === 'food-photo') {
      if (el.files.length) addFoodPhotos(el);
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
    if (form.dataset.form === 'join-paste') {
      const match = String(data.get('link')).trim().match(/(?:#join\/)?([A-Za-z0-9]{20,40})\s*$/);
      if (match) location.hash = `#join/${match[1]}`;
      else document.getElementById('share-msg').textContent = "That doesn't look like an invite link.";
      return;
    }
    if (form.dataset.form === 'share-start') {
      startSharing(form);
      return;
    }
    if (form.dataset.form === 'person') {
      const name = String(data.get('name')).trim();
      if (!name) return;
      const id = newId('p');
      save('people', [...people(), { id, name, at: Date.now() }]);
      if (form.dataset.me) setMe(id);
      refreshInfo('money');
      return;
    }
    if (form.dataset.form === 'expense') {
      const msg = document.getElementById('expense-msg');
      const what = String(data.get('what')).trim();
      const amount = Number(data.get('amount'));
      const cur = data.get('cur') === 'ILS' && rate ? 'ILS' : 'EUR';
      const ids = people().map((p) => p.id);
      const me = load('me', null);
      const paidBy = ids.length > 1 ? String(data.get('paidBy')) : (ids.includes(me) ? me : ids[0] || null);
      const split = ids.length > 1 ? data.getAll('split').map(String) : (paidBy ? [paidBy] : []);
      if (!what || !(amount > 0)) return;
      if (ids.length > 1 && !split.length) { msg.textContent = 'Pick at least one person to split it with.'; return; }
      const eur = cur === 'ILS' ? Math.round((amount / rate.ils) * 100) / 100 : amount;
      save('spend', [...load('spend', []), { id: newId('e'), what, amount, cur, eur, paidBy, split, at: Date.now(), by: meId() }]);
      refreshInfo('money');
      return;
    }
    if (form.dataset.form === 'food') {
      const name = String(data.get('name')).trim();
      if (name) {
        save('customFood', [...load('customFood', []), { id: newId('c'), name, custom: true, at: Date.now() }]);
        form.reset();
        renderFoodList();
      }
      return;
    }
    if (form.dataset.form === 'pack') {
      const item = String(data.get('item')).trim();
      if (item) save('packExtras', toggled(load('packExtras', []), item, true));
    } else if (form.dataset.form === 'ref') {
      const label = String(data.get('label')).trim();
      const value = String(data.get('value')).trim();
      if (label && value) save('refs', [...load('refs', []), { id: newId('r'), label, value, at: Date.now() }]);
    }
    refreshKit();
  });

  view.addEventListener('toggle', () => { if (map) map.invalidateSize(); }, true);
  view.addEventListener('focusout', refreshIfWaiting);
  view.addEventListener('close', refreshIfWaiting, true);

  window.addEventListener('hashchange', route);

  /* ---------- boot ---------- */
  migrateData();
  migrateTried();
  migrateFood();
  route();
  if (window.CarnetSync) {
    window.CarnetSync.init({ onData: refreshAfterSync, onStatus: showSyncStatus, readPhoto: (id) => readPhoto(id) });
  }
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
