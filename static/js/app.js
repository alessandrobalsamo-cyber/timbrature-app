const MONTHS = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno",
                 "Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
const DAY_NAMES = ["Dom","Lun","Mar","Mer","Gio","Ven","Sab"];
const TARGET_HOURS = 8.75;

const state = {
  months: [],
  overview: null,
  now: null,
  currentMonth: new Date().getMonth(),
  currentYear: new Date().getFullYear(),
  monthRows: [],
  monthTotals: null,
  edits: {},
  charts: {},
};

const $ = (id) => document.getElementById(id);

async function apiGet(path) {
  const r = await fetch(path);
  return r.json();
}
async function apiPost(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

function showToast(msg, isError) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast show" + (isError ? " error" : "");
  setTimeout(() => t.classList.remove("show"), 2500);
}

/* ---------------- time helpers ---------------- */
function parseTimeToMinutes(str) {
  if (!str) return null;
  const s = String(str).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}
function minutesToHours(min) {
  return min / 60;
}
function nowToTimeString() {
  const d = new Date();
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function fmtHours(h) {
  if (h === null || h === undefined || isNaN(h)) return "—";
  const sign = h > 0 ? "+" : "";
  return `${sign}${h.toFixed(2)}h`;
}
function balanceClass(h) {
  if (h === null || h === undefined || isNaN(h)) return "zero";
  if (h > 0.01) return "positive";
  if (h < -0.01) return "negative";
  return "zero";
}

/* ---------------- tabs ---------------- */
function initTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
      btn.classList.add("active");
      $(`view-${btn.dataset.view}`).classList.add("active");
    });
  });
}

/* ---------------- live clock ---------------- */
function startClock() {
  function tick() {
    const d = new Date();
    $("liveClock").textContent = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  tick();
  setInterval(tick, 1000);
}

/* ---------------- HOME ---------------- */
function renderRing(workedHours) {
  const ctx = $("ringChart");
  const pct = Math.max(0, Math.min(1, (workedHours || 0) / TARGET_HOURS)) * 100;
  let color = "#34d399";
  if ((workedHours || 0) < TARGET_HOURS * 0.5) color = "#f87171";
  else if ((workedHours || 0) < TARGET_HOURS * 0.9) color = "#fbbf24";

  if (state.charts.ring) state.charts.ring.destroy();
  state.charts.ring = new Chart(ctx, {
    type: "doughnut",
    data: {
      datasets: [{
        data: [pct, 100 - pct],
        backgroundColor: [color, "#2a2a3d"],
        borderWidth: 0,
        cutout: "78%",
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600 },
      plugins: { tooltip: { enabled: false }, legend: { display: false } },
    },
  });

  $("ringValue").textContent = (workedHours || 0).toFixed(workedHours ? 1 : 0);
}

function renderToday() {
  const ov = state.overview;
  const now = state.now;
  const d = new Date(now.year, now.month - 1, now.day);
  $("todayDate").textContent = d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });

  const today = ov.today;
  const entrataStr = today ? today.entrataEffettiva : "";
  const uscitaStr = today ? today.uscitaReale : "";

  const entPill = $("entrataPill"), uscPill = $("uscitaPill");
  $("entrataValue").textContent = entrataStr || "--:--";
  $("uscitaValue").textContent = uscitaStr || "--:--";
  entPill.classList.toggle("empty", !entrataStr);
  uscPill.classList.toggle("empty", !uscitaStr);

  let workedHours = null;
  const entMin = parseTimeToMinutes(entrataStr);
  const uscMin = parseTimeToMinutes(uscitaStr);
  if (entMin !== null && uscMin !== null) {
    workedHours = minutesToHours(uscMin - entMin);
  } else if (entMin !== null) {
    const nowMin = now.hourNow * 60 + now.minuteNow;
    workedHours = minutesToHours(Math.max(0, nowMin - entMin));
  }
  renderRing(workedHours);

  $("btnEntrata").disabled = !!entrataStr;
  $("btnUscita").disabled = !entrataStr || !!uscitaStr;
  $("btnEntrata").textContent = entrataStr ? "✓ Entrata timbrata" : "▶ Timbra entrata";
  $("btnUscita").textContent = uscitaStr ? "✓ Uscita timbrata" : "⏹ Timbra uscita";
}

function renderBalances() {
  const ov = state.overview;
  const now = state.now;
  const monthData = ov.months.find((m) => m.name === MONTHS[now.month - 1]);

  const monthVal = monthData ? monthData.totalScarto : null;
  $("monthBalance").textContent = fmtHours(monthVal);
  $("monthBalance").className = "value " + balanceClass(monthVal);
  $("monthBalanceSub").textContent = monthData ? `${monthData.workedDays} giorni lavorati` : "";

  const yearVal = ov.months.reduce((acc, m) => acc + (m.totalScarto || 0), 0);
  $("yearBalance").textContent = fmtHours(yearVal);
  $("yearBalance").className = "value " + balanceClass(yearVal);
  const totalWorked = ov.months.reduce((acc, m) => acc + m.workedDays, 0);
  $("yearBalanceSub").textContent = `${totalWorked} giorni totali`;
}

function renderLast7() {
  const ov = state.overview;
  const series = ov.dailySeries.slice(-7);
  const ctx = $("last7Chart");
  const labels = series.map((d) => d.label);
  const values = series.map((d) => d.scarto !== null ? d.scarto : 0);
  const colors = values.map((v) => v > 0 ? "#34d399" : v < 0 ? "#f87171" : "#6b6b8a");

  if (state.charts.last7) state.charts.last7.destroy();
  state.charts.last7 = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 6, maxBarThickness: 28 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.raw > 0 ? "+" : ""}${c.raw.toFixed(2)}h` } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#9494b0", font: { size: 10 } } },
        y: { grid: { color: "#22222f" }, ticks: { color: "#9494b0", font: { size: 10 } } },
      },
    },
  });
}

function renderAnomalyBanner() {
  const ov = state.overview;
  const anomalies = ov.dailySeries.filter((d) => d.anomaly);
  const el = $("anomalyBanner");
  if (!anomalies.length) { el.innerHTML = ""; return; }
  const last = anomalies[anomalies.length - 1];
  el.innerHTML = `<div class="banner"><span class="ic">⚠️</span>
    <span>Il <b>${last.label}</b> (${last.month}) lo scarto flessibilità è di <b>${fmtHours(last.scarto)}</b> &mdash;
    probabile timbratura mancante. Controlla nel Calendario.</span></div>`;
}

/* ---------------- CALENDAR ---------------- */
async function loadMonth() {
  const container = $("daysContainer");
  container.innerHTML = '<div class="loading"><div class="spinner"></div><span>Caricamento...</span></div>';
  const name = MONTHS[state.currentMonth];
  $("monthLabel").textContent = `${name} ${state.currentYear}`;
  const data = await apiGet(`/api/month/${encodeURIComponent(name)}`);
  if (data.error) {
    container.innerHTML = `<div class="loading"><span style="color:var(--red)">❌ ${data.error}</span></div>`;
    return;
  }
  state.monthRows = data.rows || [];
  state.monthTotals = data.totals || null;
  state.edits = {};
  renderMonth();
}

function renderMonth() {
  const rows = state.monthRows;
  const daysInMonth = new Date(state.currentYear, state.currentMonth + 1, 0).getDate();
  const now = state.now;
  let worked = 0, partial = 0, html = "";

  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(state.currentYear, state.currentMonth, d).getDay();
    const wk = dow === 0 || dow === 6;
    const isToday = d === now.day && state.currentMonth === now.month - 1 && state.currentYear === now.year;
    const rd = rows[d - 1] || {};
    const e = state.edits[d] || {};
    const ent = e.entrata !== undefined ? e.entrata : (rd.entrataEffettiva || "");
    const usc = e.uscita !== undefined ? e.uscita : (rd.uscitaReale || "");
    const ePrev = rd.entrataPrevista || "";
    const uscPrev = rd.uscitaPrevista || "";
    const scarto = rd.scarto;
    const commessa = rd.lavoro || "";
    const anomaly = scarto !== null && scarto !== undefined && Math.abs(scarto) >= 4 && ent;

    let st = "empty", ic = "○";
    if (ent && usc) { st = "full"; ic = "✓"; worked++; }
    else if (ent || usc) { st = "partial"; ic = "◐"; partial++; }

    let pillClass = "neutral", pillText = "";
    if (ent && scarto !== null && scarto !== undefined) {
      pillClass = scarto > 0.01 ? "positive" : scarto < -0.01 ? "negative" : "neutral";
      pillText = fmtHours(scarto);
    }

    html += `<div class="day-row ${isToday ? "today" : ""} ${wk ? "weekend" : ""} ${anomaly ? "anomaly" : ""}" data-day="${d}">
      <div class="day-info"><div class="day-num">${d}</div><span class="day-name">${DAY_NAMES[dow]}</span></div>
      <div class="inp-group"><label>Entrata</label>
        <input type="text" inputmode="numeric" value="${ent}" placeholder="${ePrev || "7:15"}" data-day="${d}" data-field="entrata" class="time-inp">
        ${ePrev ? `<div class="prev-time">📌 ${ePrev}</div>` : ""}
      </div>
      <div class="inp-group"><label>Uscita</label>
        <input type="text" inputmode="numeric" value="${usc}" placeholder="${uscPrev || "16:00"}" data-day="${d}" data-field="uscita" class="time-inp">
        ${uscPrev ? `<div class="prev-time">📌 ${uscPrev}</div>` : ""}
      </div>
      <div class="meta-col">
        ${pillText ? `<div class="scarto-pill ${pillClass}">${pillText}</div>` : ""}
        ${commessa && commessa.toLowerCase() !== "ferie" ? `<div class="commessa">📝 ${commessa}</div>` : (commessa ? `<div class="commessa">🏖️ ${commessa}</div>` : "")}
      </div>
      <div class="status-dot ${st}">${ic}</div>
    </div>`;
  }

  $("daysContainer").innerHTML = html;

  const totalScarto = state.monthTotals ? state.monthTotals.scarto : null;
  $("statsStrip").innerHTML = `
    <div class="stat-chip"><div class="sc-label">Completati</div><div class="sc-value" style="color:var(--green)">${worked}</div></div>
    <div class="stat-chip"><div class="sc-label">Parziali</div><div class="sc-value" style="color:var(--orange)">${partial}</div></div>
    <div class="stat-chip"><div class="sc-label">Progresso</div><div class="sc-value" style="color:var(--accent)">${Math.round(((worked + partial * 0.3) / daysInMonth) * 100)}%</div></div>
    <div class="stat-chip"><div class="sc-label">Saldo mese</div><div class="sc-value ${balanceClass(totalScarto)}">${fmtHours(totalScarto)}</div></div>`;

  document.querySelectorAll(".time-inp").forEach((inp) => {
    inp.addEventListener("focus", (e) => e.target.select());
    inp.addEventListener("change", onInputChange);
  });

  if (now.day <= daysInMonth && state.currentMonth === now.month - 1 && state.currentYear === now.year) {
    setTimeout(() => {
      const el = document.querySelector(".day-row.today");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
  }
}

function onInputChange(e) {
  const inp = e.target;
  const d = inp.dataset.day, f = inp.dataset.field, v = inp.value.trim();
  if (!state.edits[d]) state.edits[d] = {};
  state.edits[d][f] = v;
}

async function saveAll() {
  const days = Object.keys(state.edits);
  if (!days.length) { showToast("Nessuna modifica da salvare"); return; }
  const name = MONTHS[state.currentMonth];
  let ok = 0, err = 0;
  for (const d of days) {
    const eds = state.edits[d];
    for (const field of ["entrata", "uscita"]) {
      if (eds[field] === undefined) continue;
      const r = await apiPost("/api/update", { sheet: name, giorno: parseInt(d, 10), field, value: eds[field] });
      if (r.status === "ok") ok++; else err++;
    }
    const row = document.querySelector(`.day-row[data-day="${d}"]`);
    if (row) { row.classList.remove("saved"); void row.offsetWidth; row.classList.add("saved"); }
  }
  showToast(err ? `Salvato con ${err} errori` : `✅ ${ok} modifiche salvate`, !!err);
  await refreshAll();
}

async function changeMonth(delta) {
  state.currentMonth += delta;
  if (state.currentMonth < 0) { state.currentMonth = 11; state.currentYear--; }
  if (state.currentMonth > 11) { state.currentMonth = 0; state.currentYear++; }
  await loadMonth();
}

/* ---------------- STATS ---------------- */
function renderStats() {
  const ov = state.overview;

  // monthly bar chart
  const labels = ov.months.map((m) => m.name.slice(0, 3));
  const values = ov.months.map((m) => m.totalScarto);
  const colors = values.map((v) => v > 0 ? "#34d399" : v < 0 ? "#f87171" : "#6b6b8a");
  if (state.charts.monthly) state.charts.monthly.destroy();
  state.charts.monthly = new Chart($("monthlyChart"), {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmtHours(c.raw) } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#9494b0", font: { size: 10 } } },
        y: { grid: { color: "#22222f" }, ticks: { color: "#9494b0", font: { size: 10 } } },
      },
    },
  });

  // cumulative line chart
  const series = ov.dailySeries;
  if (state.charts.cumulative) state.charts.cumulative.destroy();
  state.charts.cumulative = new Chart($("cumulativeChart"), {
    type: "line",
    data: {
      labels: series.map((d) => d.label),
      datasets: [{
        data: series.map((d) => d.cumulative),
        borderColor: "#8b5cf6",
        backgroundColor: "rgba(139,92,246,0.15)",
        fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmtHours(c.raw) } } },
      scales: {
        x: { display: false },
        y: { grid: { color: "#22222f" }, ticks: { color: "#9494b0", font: { size: 10 } } },
      },
    },
  });

  // composition doughnut
  const totalWorked = ov.months.reduce((a, m) => a + m.workedDays, 0);
  const totalFerie = ov.months.reduce((a, m) => a + m.ferieDays, 0);
  const totalSw = ov.months.reduce((a, m) => a + m.swDays, 0);
  const normal = Math.max(0, totalWorked - totalFerie - totalSw);
  if (state.charts.composition) state.charts.composition.destroy();
  state.charts.composition = new Chart($("compositionChart"), {
    type: "doughnut",
    data: {
      labels: ["Lavorati", "Ferie", "Smart working"],
      datasets: [{ data: [normal, totalFerie, totalSw], backgroundColor: ["#8b5cf6", "#fbbf24", "#60a5fa"], borderWidth: 0 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
    },
  });
  $("compositionLegend").innerHTML = `
    <span><span class="legend-dot" style="background:#8b5cf6"></span>Lavorati: ${normal}</span>
    <span><span class="legend-dot" style="background:#fbbf24"></span>Ferie: ${totalFerie}</span>
    <span><span class="legend-dot" style="background:#60a5fa"></span>Smart working: ${totalSw}</span>`;

  // summary grid
  const yearVal = ov.months.reduce((acc, m) => acc + (m.totalScarto || 0), 0);
  const scartoValues = series.map((d) => d.scarto).filter((v) => v !== null && v !== undefined);
  const avg = scartoValues.length ? scartoValues.reduce((a, b) => a + b, 0) / scartoValues.length : 0;
  const best = series.reduce((max, d) => (d.scarto !== null && (max === null || d.scarto > max.scarto)) ? d : max, null);
  const worst = series.reduce((min, d) => (d.scarto !== null && (min === null || d.scarto < min.scarto)) ? d : min, null);

  $("summaryGrid").innerHTML = `
    <div class="stat-chip"><div class="sc-label">Saldo anno</div><div class="sc-value ${balanceClass(yearVal)}">${fmtHours(yearVal)}</div></div>
    <div class="stat-chip"><div class="sc-label">Giorni lavorati</div><div class="sc-value">${totalWorked}</div></div>
    <div class="stat-chip"><div class="sc-label">Media giornaliera</div><div class="sc-value ${balanceClass(avg)}">${fmtHours(avg)}</div></div>
    <div class="stat-chip"><div class="sc-label">Giorni ferie</div><div class="sc-value" style="color:var(--orange)">${totalFerie}</div></div>
    <div class="stat-chip"><div class="sc-label">Miglior giorno</div><div class="sc-value positive">${best ? fmtHours(best.scarto) + " (" + best.label + ")" : "—"}</div></div>
    <div class="stat-chip"><div class="sc-label">Peggior giorno</div><div class="sc-value negative">${worst ? fmtHours(worst.scarto) + " (" + worst.label + ")" : "—"}</div></div>`;
}

/* ---------------- bootstrap ---------------- */
async function refreshAll() {
  const [now, overview] = await Promise.all([apiGet("/api/now"), apiGet("/api/overview")]);
  if (overview.error) { showToast("Errore: " + overview.error, true); return; }
  const d = new Date();
  state.now = { ...overview.now, hourNow: d.getHours(), minuteNow: d.getMinutes() };
  state.overview = overview;
  renderToday();
  renderBalances();
  renderLast7();
  renderAnomalyBanner();
  renderStats();
}

async function quickStamp(field) {
  const now = state.now;
  const name = MONTHS[now.month - 1];
  const value = nowToTimeString();
  const r = await apiPost("/api/update", { sheet: name, giorno: now.day, field, value });
  if (r.status === "ok") {
    showToast(`✅ ${field === "entrata" ? "Entrata" : "Uscita"} timbrata: ${value}`);
    await refreshAll();
    if (state.currentMonth === now.month - 1 && state.currentYear === now.year) await loadMonth();
  } else {
    showToast("Errore: " + r.error, true);
  }
}

async function init() {
  initTabs();
  startClock();

  const now = await apiGet("/api/now");
  state.currentMonth = now.month - 1;
  state.currentYear = now.year;

  $("prevBtn").addEventListener("click", () => changeMonth(-1));
  $("nextBtn").addEventListener("click", () => changeMonth(1));
  $("resetBtn").addEventListener("click", () => { state.edits = {}; loadMonth(); showToast("↻ Ricaricato"); });
  $("saveBtn").addEventListener("click", saveAll);
  $("btnEntrata").addEventListener("click", () => quickStamp("entrata"));
  $("btnUscita").addEventListener("click", () => quickStamp("uscita"));

  await refreshAll();
  await loadMonth();

  setInterval(() => {
    const d = new Date();
    state.now.hourNow = d.getHours();
    state.now.minuteNow = d.getMinutes();
    if (!state.overview.today || !state.overview.today.uscitaReale) renderRing(
      state.overview.today && state.overview.today.entrataEffettiva
        ? minutesToHours(Math.max(0, (d.getHours() * 60 + d.getMinutes()) - parseTimeToMinutes(state.overview.today.entrataEffettiva)))
        : null
    );
  }, 30000);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

init();
