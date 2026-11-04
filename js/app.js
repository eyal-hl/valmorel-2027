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
  const TABS = [['home', 'Home'], ['plan', 'Plan'], ['included', 'Included'], ['mountain', 'Slopes'], ['explore', 'Explore'], ['food', 'Food'], ['kit', 'Kit']];
  const currentTab = () => { const id = location.hash.slice(1); return TABS.some(([t]) => t === id) ? id : 'home'; };

  let map = null;
  let ticker = null;

  function route() {
    if (ticker) { clearInterval(ticker); ticker = null; }
    if (map) { map.remove(); map = null; overlay = null; }
    const tab = currentTab();
    document.getElementById('nav').innerHTML = TABS
      .map(([id, label]) => `<a href="#${id}" ${id === tab ? 'aria-current="page"' : ''}>${label}</a>`)
      .join('');
    ({ home: renderHome, plan: renderPlan, included: renderIncluded, mountain: renderMountain, explore: renderExplore, food: renderFood, kit: renderKit })[tab]();
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

  function datesHtml() {
    if (phase() === 'after') return '';
    const t = today();
    const until = (date) => {
      const n = dayDiff(t, date);
      if (n === 0) return 'Today';
      if (n < 0) return 'Done';
      return n === 1 ? 'Tomorrow' : `In ${n} days`;
    };
    return `<section>
      <h2 class="section-title">Key dates</h2>
      <ul class="key-dates">
        ${trip.dates.map((k) => `<li class="${k.date < t ? 'is-past' : ''}">
          <span class="kd-when"><strong>${esc(shortDate(k.date))}</strong><small class="muted">${esc(until(k.date))}</small></span>
          <span><strong>${esc(k.title)}</strong><small class="muted">${esc(k.detail)}</small></span>
        </li>`).join('')}
      </ul>
      <button class="btn btn-quiet" data-action="calendar">Add to my calendar</button>
    </section>`;
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
        <h2 class="section-title">What your lift pass covers</h2>
        <p>${esc(trip.liftPass.intro)}</p>
        <div class="inc-groups pass-groups">
          <article class="inc-group">
            <h3>Covered</h3>
            <ul class="inc-list">${trip.liftPass.covered.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
          </article>
          <article class="inc-group not-covered">
            <h3>Not covered</h3>
            <ul class="inc-list no-list">${trip.liftPass.notCovered.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
          </article>
        </div>
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
    view.innerHTML = `${heroHtml()}${nextUpHtml()}${todayHtml()}
      <section>
        <h2 class="section-title">Valmorel right now</h2>
        <div id="weather"><p class="muted">Loading the forecast…</p></div>
      </section>
      ${todosHtml()}${datesHtml()}${stayHtml()}`;
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
        ${trip.mapDays.some((m) => m.date === day.date) ? `<button class="chip map-this-day" data-action="map-this-day" data-date="${esc(day.date)}">Map this day</button>` : ''}
        ${journalHtml(day)}
      </article>`).join('')}
      <section>
        <h2 class="section-title">Your journal</h2>
        <p class="muted lede">Notes are saved on this device only. Copy them somewhere safe at the end of the trip.</p>
        <button class="btn btn-quiet" data-action="copy-journal">Copy the whole journal</button>
        <p class="muted small" id="journal-status" role="status"></p>
      </section>
      <section>
        <h2 class="section-title">Transfer times</h2>
        <p class="muted lede">Club Med is handling your flights and transfers. These are its typical times to the resort, for reference.</p>
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

  const PISTE_COLOR = { novice: '#2e8b57', easy: '#2563c9', intermediate: '#d0212a', advanced: '#111111' };
  const PISTE_NAME = { novice: 'Green', easy: 'Blue', intermediate: 'Red', advanced: 'Black' };
  const COLOUR_HEX = { green: '#2e8b57', blue: '#2563c9', red: '#d0212a', black: '#111111' };
  const PASS_LABEL = { covered: 'Lift pass covers it', none: 'No lift pass needed', extra: 'Costs extra', separate: 'Needs a separate pass', meal: 'Lift pass gets you there, meal costs extra' };
  const mapState = { day: null };
  let overlay = null;
  let dayLegs = [];

  function defaultMapDay() {
    const todays = trip.mapDays.find((m) => m.date === today());
    return todays ? todays.id : 'all';
  }

  function mapHtml() {
    if (!mapState.day) mapState.day = defaultMapDay();
    const chip = (id, label) => `<button class="chip" aria-pressed="${mapState.day === id}" data-action="map-day" data-day="${esc(id)}">${esc(label)}</button>`;
    return `<section class="map-section" id="map-section">
      <div class="chips day-chips" role="group" aria-label="Choose a day">
        ${chip('all', 'Everything')}${trip.mapDays.map((m) => chip(m.id, m.label)).join('')}
      </div>
      <div id="map" class="map"></div>
      <p class="legend">
        <span><i class="dot" style="background:#2e8b57"></i>Green</span>
        <span><i class="dot" style="background:#2563c9"></i>Blue</span>
        <span><i class="dot" style="background:#d0212a"></i>Red</span>
        <span><i class="dot" style="background:#111"></i>Black</span>
        <span><i class="line-key"></i>Lift</span>
        <span><i class="line-key route-key"></i>Today's route</span>
      </p>
      <div id="day-panel" class="day-panel"></div>
    </section>`;
  }

  function initMap() {
    if (!window.L) {
      document.getElementById('map').innerHTML = '<p class="muted map-fallback">The map could not load.</p>';
      showDayPanel();
      return;
    }
    map = L.map('map', { scrollWheelZoom: false, preferCanvas: true, renderer: L.canvas({ tolerance: 8 }) });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    const data = window.MOUNTAIN;
    if (data) {
      data.pistes.forEach((p) => {
        const level = PISTE_NAME[p.d];
        L.polyline(p.p, { color: PISTE_COLOR[p.d] || '#777777', weight: 2.5, opacity: 0.6 }).addTo(map)
          .bindPopup(`<strong>${esc(p.n || (p.k === 'park' ? 'Snow park' : 'Piste'))}</strong>${level ? `<br>${level} run` : ''}<br>Your lift pass covers it`);
      });
      data.lifts.forEach((l) => {
        const zip = l.t === 'zip line';
        const clubMed = l.n.startsWith('Club Med');
        L.polyline(l.p, { color: '#14213d', weight: 2, opacity: 0.85, dashArray: zip ? '2 6' : '6 4' }).addTo(map)
          .bindPopup(`<strong>${esc(l.n || 'Lift')}</strong><br>${esc(l.t)}<br>${zip ? 'Booked separately' : clubMed ? 'Club Med beginner carpet' : 'Your lift pass covers it'}`);
      });
    }
    overlay = L.layerGroup().addTo(map);
    showMapDay(mapState.day);
  }

  function addResortPin() {
    L.marker([resort.lat, resort.lon], {
      icon: L.divIcon({ className: '', html: '<span class="map-pin">★</span>', iconSize: [34, 34], iconAnchor: [17, 17] }),
      title: resort.name,
      zIndexOffset: 500,
    }).addTo(overlay).bindPopup(`<strong>${esc(resort.name)}</strong><br>${esc(shortDate(startDate))} to ${esc(shortDate(endDate))}`);
  }

  function numberPin(n, at, title) {
    return L.marker(at, {
      icon: L.divIcon({ className: '', html: `<span class="map-step">${n}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
      title,
      zIndexOffset: 600,
    }).addTo(overlay).bindPopup(`<strong>${n}. ${esc(title)}</strong>`);
  }

  function showMapDay(id) {
    mapState.day = id;
    document.querySelectorAll('[data-action="map-day"]').forEach((b) => {
      const on = b.dataset.day === id;
      b.setAttribute('aria-pressed', String(on));
      if (on) b.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' });
    });
    dayLegs = [];
    if (map && overlay) {
      overlay.clearLayers();
      addResortPin();
      if (id === 'all') {
        trip.gateways.forEach((g) => {
          L.marker([g.lat, g.lon], {
            icon: L.divIcon({ className: '', html: '<span class="map-square"></span>', iconSize: [14, 14], iconAnchor: [7, 7] }),
            title: g.name,
          }).addTo(overlay).bindPopup(`<strong>${esc(g.name)}</strong><br>${esc(g.time)} to the resort`);
        });
        trip.attractions.forEach((x) => {
          L.circleMarker([x.lat, x.lon], { radius: 7, color: '#fff', weight: 2, fillColor: STATUS_COLOR[x.area], fillOpacity: 1 }).addTo(overlay)
            .bindPopup(`<strong>${esc(x.name)}</strong><br>${esc(x.why)}<br><em>${esc(PASS_LABEL[x.pass] || '')}</em><br><a href="${esc(mapsUrl(x.q))}" target="_blank" rel="noopener">Open in Maps</a>`);
        });
        fitMap('resort');
      } else {
        const day = trip.mapDays.find((m) => m.id === id);
        const legs = day.route && window.MOUNTAIN ? window.MOUNTAIN.routes[day.route] : [];
        const points = [[resort.lat, resort.lon]];
        legs.forEach((leg, i) => {
          if (leg.k === 'ride') L.polyline(leg.p, { color: '#ffffff', weight: 9, opacity: 0.9 }).addTo(overlay);
          const line = L.polyline(leg.p, { color: leg.k === 'lift' ? '#14213d' : '#ff6a00', weight: leg.k === 'lift' ? 5 : 5, opacity: 1 }).addTo(overlay);
          dayLegs[i] = line;
          numberPin(i + 1, leg.p[0], leg.k === 'lift' ? `${leg.n} ${leg.t}` : `Ride ${leg.names.map((n) => n.n).join(', ')}`);
          points.push(...leg.p);
        });
        day.stops.forEach((s) => {
          L.circleMarker([s.lat, s.lon], { radius: 8, color: '#fff', weight: 2, fillColor: '#6b2fa0', fillOpacity: 1 }).addTo(overlay)
            .bindPopup(`<strong>${esc(s.name)}</strong><br>${esc(s.note)}`);
          points.push([s.lat, s.lon]);
        });
        map.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 14 });
      }
    }
    showDayPanel();
  }

  function showDayPanel() {
    const panel = document.getElementById('day-panel');
    if (!panel) return;
    const id = mapState.day;
    if (id === 'all') {
      panel.innerHTML = `<p class="muted">Tap any run or lift for its name. Pick a day above to see a suggested route. Lifts and runs come from OpenStreetMap, so colours can differ slightly from the official map.</p>
        <div class="chips" role="group" aria-label="Zoom the map to">
          <button class="chip" data-action="map-fit" data-fit="resort">The resort</button>
          <button class="chip" data-action="map-fit" data-fit="region">Day trips</button>
          <button class="chip" data-action="map-fit" data-fit="all">Airports too</button>
        </div>`;
      return;
    }
    const day = trip.mapDays.find((m) => m.id === id);
    const legs = day.route && window.MOUNTAIN ? window.MOUNTAIN.routes[day.route] : [];
    const lifts = legs.filter((l) => l.k === 'lift');
    const drags = [...new Set(lifts.filter((l) => l.t === 'drag lift').map((l) => l.n))];
    const liftNote = lifts.length ? (drags.length ? `Needs a drag lift: ${drags.join(', ')}.` : 'No drag lifts on this route.') : '';
    const legHtml = legs.map((leg, i) => (leg.k === 'lift'
      ? `<li><button class="leg" data-action="map-leg" data-index="${i}"><strong>${esc(leg.n)} ${esc(leg.t)}</strong><span class="muted">Lift pass covers it</span></button></li>`
      : `<li><button class="leg" data-action="map-leg" data-index="${i}"><strong>Ride down, about ${(leg.len / 1000).toFixed(1)} km</strong><span class="run-names">${leg.names.map((n) => `<span><i class="dot" style="background:${COLOUR_HEX[n.c] || '#777'}"></i>${esc(n.n)}</span>`).join('')}</span></button></li>`)).join('');
    panel.innerHTML = `<h3 class="sub-title">${esc(day.title)} <span class="badge ${day.pass ? 'status-booked' : 'status-idea'}">${day.pass ? 'Lift pass day' : 'No lift pass'}</span> ${day.idea === false ? '' : '<span class="badge status-idea">Idea</span>'}</h3>
      <p>${esc(day.blurb)}</p>
      ${liftNote ? `<p><strong>${esc(liftNote)}</strong></p>` : ''}
      ${(day.warn || []).length ? `<ul class="map-warn">${day.warn.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      ${day.lead ? `<p class="muted">${esc(day.lead)}</p>` : ''}
      ${legs.length ? `<ol class="steps route-steps">${legHtml}</ol>` : ''}
      ${day.stops.length ? `<ul class="pay-list">${day.stops.map((s) => `<li><strong>${esc(s.name)}</strong><span class="muted">${esc(s.note)}</span></li>`).join('')}</ul>` : ''}
      ${legs.length ? '<p class="muted small">A suggested route worked out from map data. Follow the piste signs, and check what is open on the day.</p>' : ''}`;
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

  /* ---------- explore ---------- */
  const exploreState = { type: 'All', show: 'all' };
  const TYPES = ['All', ...new Set(trip.attractions.map((a) => a.type))];

  function eveningsHtml() {
    const { evenings } = trip;
    const rows = (items) => `<ul class="pay-list">${items.map((i) => `<li>
      <strong>${esc(i.title)}</strong>
      <span class="muted">${esc(i.detail)}${i.phone ? ` <a href="tel:${esc(i.phone)}">${esc(i.phoneLabel)}</a>` : ''}</span>
    </li>`).join('')}</ul>`;
    return `<section id="evenings" class="jump-target">
      <h2 class="section-title">Evenings and nights</h2>
      <p class="muted lede">${esc(evenings.note)}</p>
      <h3 class="sub-title">At Club Med <span class="badge status-booked">Included</span></h3>
      ${rows(evenings.clubMed)}
      <h3 class="sub-title">Getting to the village at night</h3>
      <p class="muted">${esc(evenings.gettingThere)}</p>
      <h3 class="sub-title">Things to do <span class="badge status-idea">Most cost extra</span></h3>
      ${rows(evenings.activities)}
      <h3 class="sub-title">Bars and restaurants <span class="badge status-idea">Pay as you go</span></h3>
      ${rows(evenings.village)}
      <h3 class="sub-title">Probably not on your week</h3>
      ${rows(evenings.unlikely)}
    </section>`;
  }

  function renderExplore() {
    view.innerHTML = `<h1 class="page-title">Explore</h1>
      <div class="chips" role="group" aria-label="Jump to">
        <button class="chip" data-action="jump" data-target="map-section">Map by day</button>
        <button class="chip" data-action="jump" data-target="things">Things to do</button>
        <button class="chip" data-action="jump" data-target="evenings">Evenings</button>
        <a class="chip" href="#food">Food</a>
      </div>
      ${mapHtml()}
      <section id="things" class="jump-target">
        <h2 class="section-title">Things to do</h2>
        <div id="explore-results"></div>
      </section>
      ${eveningsHtml()}`;
    renderExploreResults();
    initMap();
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

    document.getElementById('explore-results').innerHTML = `<p class="muted">${visited.length} of ${trip.attractions.length} done · ${favs.length} saved. Drive times are rough estimates in good conditions.</p>
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
            <p class="card-badges">
              <span class="badge ${a.onPiste ? 'status-booked' : 'status-idea'}">${a.onPiste ? 'On the piste map' : 'Not on the piste map'}</span>
              <span class="badge ${a.pass === 'covered' ? 'status-booked' : a.pass === 'none' ? 'status-idea' : 'status-todo'}">${esc(PASS_LABEL[a.pass] || '')}</span>
            </p>
            <div class="card-actions">
              <button class="chip" aria-pressed="${fav}" data-action="toggle-list" data-list="favs" data-name="${esc(a.name)}">${fav ? 'Saved' : 'Save'}</button>
              <button class="chip" aria-pressed="${seen}" data-action="toggle-list" data-list="visited" data-name="${esc(a.name)}">${seen ? 'Done' : 'Mark done'}</button>
              <button class="chip" data-action="map-focus" data-lat="${a.lat}" data-lon="${a.lon}">On the map</button>
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
        <ul class="map-warn">${m.lastLifts.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
        <p class="muted small">From the 2025-26 piste map. Times are subject to change.</p>
      </section>

      <section>
        <h2 class="section-title">Check before you ride</h2>
        <p class="muted lede">These open Valmorel's and Météo-France's live pages. For your daily routes, open the Explore tab.</p>
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
          ${m.board.map((l) => `<li><strong>${esc(l.title)}</strong><span class="muted">${esc(l.detail)}</span></li>`).join('')}
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
        const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.naturalWidth * scale);
        canvas.height = Math.round(image.naturalHeight * scale);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not process that image'))), 'image/jpeg', 0.82);
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

  // Carry over ticks from the old checklist in Explore.
  function migrateTried() {
    const old = load('tried', null);
    if (!old) return;
    const log = load('foodLog', {});
    old.forEach((id) => { log[id] = { ...log[id], tried: true }; });
    save('foodLog', log);
    try { localStorage.removeItem(storeKey('tried')); } catch (err) { /* storage blocked */ }
  }

  function foodCardHtml(f) {
    const entry = foodEntry(f.id);
    const rating = entry.rating || 0;
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
      <textarea id="note-${esc(f.id)}" class="food-note" data-action="food-note" data-id="${esc(f.id)}" rows="2" placeholder="Where you had it, what you thought…">${esc(entry.note || '')}</textarea>
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
    const ids = foodEntry(id).photos || [];
    const urls = await Promise.all(ids.map(async (photoId) => {
      if (photoUrls.has(photoId)) return [photoId, photoUrls.get(photoId)];
      try {
        const blob = await readPhoto(photoId);
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        photoUrls.set(photoId, url);
        return [photoId, url];
      } catch (err) { return null; }
    }));
    holder.innerHTML = urls.filter(Boolean).map(([photoId, url]) => `<button class="food-thumb" data-action="food-view" data-id="${esc(id)}" data-photo="${esc(photoId)}" aria-label="View photo of ${esc(name)}"><img src="${esc(url)}" alt=""></button>`).join('');
  }

  function foodSummary() {
    const log = load('foodLog', {});
    const foods = allFood();
    const tried = foods.filter((f) => (log[f.id] || {}).tried).length;
    const ratings = foods.map((f) => (log[f.id] || {}).rating).filter(Boolean);
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
    if (foodState.show === 'best') list.sort((x, y) => ((log[y.id] || {}).rating || 0) - ((log[x.id] || {}).rating || 0));
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
    const filter = (value, label) => `<button class="chip" aria-pressed="${foodState.show === value}" data-action="food-filter" data-value="${value}">${label}</button>`;
    view.innerHTML = `<h1 class="page-title">Food</h1>
      <p class="muted lede"><strong id="food-summary"></strong><br>Ratings, notes and photos stay on this phone only, so keep your originals in your gallery too.</p>
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
        updateFood(id, { photos: [...(foodEntry(id).photos || []), photoId], tried: true });
      } catch (err) { failed += 1; }
    }
    refreshFoodCard(id);
    if (failed) {
      const after = view.querySelector(`[data-food="${CSS.escape(id)}"] .food-status`);
      if (after) after.textContent = `${plural(failed, 'photo')} could not be saved. Your phone may be low on space, or the format may not be supported.`;
    }
  }

  const viewer = { id: null, photo: null };

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
    const spend = load('spend', []);
    const spent = spend.reduce((sum, s) => sum + s.amount, 0);
    const euro = (n) => `€${n.toFixed(2)}`;
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
        <h2 class="section-title">Spending <span class="muted small">${euro(spent)} so far</span></h2>
        <p class="muted">Log rental, spa and other extras so the final bill has no surprises. Saved on this device only.</p>
        <ul class="refs">
          ${spend.map((s, i) => `<li>
            <span><strong>${esc(s.what)}</strong><br>${euro(s.amount)}</span>
            <button class="chip" data-action="del-spend" data-index="${i}" aria-label="Remove ${esc(s.what)}">Remove</button>
          </li>`).join('')}
        </ul>
        <form class="inline-form" data-form="spend">
          <label class="sr-only" for="spend-what">What it was for</label>
          <input id="spend-what" name="what" placeholder="e.g. Board rental" autocomplete="off" required>
          <label class="sr-only" for="spend-amount">Amount in euros</label>
          <input id="spend-amount" name="amount" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="Amount in €" required>
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
    renderKit();
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
      updateFood(el.dataset.id, { note: el.value });
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
      const current = foodEntry(el.dataset.id).rating || 0;
      updateFood(el.dataset.id, value === current ? { rating: 0 } : { rating: value, tried: true });
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
      updateFood(id, { photos: (foodEntry(id).photos || []).filter((p) => p !== photo) });
      erasePhoto(photo).catch(() => {});
      if (photoUrls.has(photo)) { URL.revokeObjectURL(photoUrls.get(photo)); photoUrls.delete(photo); }
      refreshFoodCard(id);
    } else if (action === 'food-remove') {
      if (!window.confirm('Remove this dish, with its rating, note and photos?')) return;
      const { id } = el.dataset;
      (foodEntry(id).photos || []).forEach((p) => erasePhoto(p).catch(() => {}));
      const log = load('foodLog', {});
      delete log[id];
      save('foodLog', log);
      save('customFood', load('customFood', []).filter((f) => f.id !== id));
      renderFoodList();
    } else if (action === 'jump') {
      document.getElementById(el.dataset.target).scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (action === 'calendar') {
      downloadCalendar();
    } else if (action === 'copy-journal') {
      copyJournal();
    } else if (action === 'say') {
      speakFrench(el.dataset.text);
    } else if (action === 'del-spend') {
      const spend = load('spend', []);
      spend.splice(Number(el.dataset.index), 1);
      save('spend', spend);
      refreshKit();
    } else if (action === 'jump-lessons') {
      document.getElementById('lessons').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (action === 'map-day') {
      showMapDay(el.dataset.day);
    } else if (action === 'map-leg') {
      const line = dayLegs[Number(el.dataset.index)];
      if (line && map) {
        map.fitBounds(line.getBounds(), { padding: [40, 40], maxZoom: 15 });
        document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else if (action === 'map-this-day') {
      mapState.day = trip.mapDays.find((m) => m.date === el.dataset.date).id;
      location.hash = '#explore';
    } else if (action === 'map-focus') {
      if (mapState.day !== 'all') showMapDay('all');
      if (map) map.setView([Number(el.dataset.lat), Number(el.dataset.lon)], 14);
      document.getElementById('map-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    if (form.dataset.form === 'food') {
      const name = String(data.get('name')).trim();
      if (name) {
        save('customFood', [...load('customFood', []), { id: `c${Date.now()}`, name, custom: true }]);
        form.reset();
        renderFoodList();
      }
      return;
    }
    if (form.dataset.form === 'pack') {
      const item = String(data.get('item')).trim();
      if (item) save('packExtras', toggled(load('packExtras', []), item, true));
    } else if (form.dataset.form === 'spend') {
      const what = String(data.get('what')).trim();
      const amount = Number(data.get('amount'));
      if (what && amount > 0) save('spend', [...load('spend', []), { what, amount }]);
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
