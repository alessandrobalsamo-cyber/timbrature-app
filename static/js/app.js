const MONTHS = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno",
                 "Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
const DAY_NAMES = ["Dom","Lun","Mar","Mer","Gio","Ven","Sab"];

const TARGET_HOURS = 8;       // ore nette giornaliere richieste
const PAUSA_HOURS = 0.75;     // pausa pranzo (45 minuti)
const SW_ENTRATA = "07:45";
const SW_USCITA = "16:30";

const STORAGE_KEY = "timbrature_data_v1";

const state = {
  currentMonth: new Date().getMonth(),
  currentYear: new Date().getFullYear(),
  charts: {},
};

const $ = (id) => document.getElementById(id);

/* ---------------- storage ---------------- */
function loadData() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}
function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
function monthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}
function getDay(data, year, month, day) {
  const mk = monthKey(year, month);
  return (data[mk] && data[mk][String(day)]) || {};
}
function setDayField(year, month, day, field, value) {
  const data = loadData();
  const mk = monthKey(year, month);
  if (!data[mk]) data[mk] = {};
  if (!data[mk][String(day)]) data[mk][String(day)] = {};
  data[mk][String(day)][field] = value;
  saveData(data);
  return data;
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
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function padTime(str) {
  const mins = parseTimeToMinutes(str);
  if (mins === null) return "";
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}
function addMinutesToTime(str, minutesToAdd) {
  const mins = parseTimeToMinutes(str);
  if (mins === null) return "";
  let total = (mins + minutesToAdd) % 1440;
  if (total < 0) total += 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
function isValidTime(str) {
  return /^([0-1]?\d|2[0-3]):[0-5]\d$/.test(String(str).trim());
}
function formatTimeInput(e) {
  const inp = e.target;
  const digits = inp.value.replace(/\D/g, "").slice(0, 4);
  let formatted = digits;
  if (digits.length >= 3) formatted = `${digits.slice(0, 2)}:${digits.slice(2)}`;
  inp.value = formatted;
}
function fmtHoursMin(h) {
  if (h === null || h === undefined || isNaN(h)) return "—";
  const totalMin = Math.round(Math.abs(h) * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  if (hh === 0 && mm === 0) return "0 min";
  const sign = h > 0.0001 ? "+" : h < -0.0001 ? "-" : "";
  if (hh === 0) return `${sign}${mm} min`;
  if (mm === 0) return `${sign}${hh} h`;
  return `${sign}${hh} h ${mm} min`;
}
function fmtDuration(h) {
  if (h === null || h === undefined || isNaN(h)) return "—";
  const totalMin = Math.round(Math.abs(h) * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  if (hh === 0 && mm === 0) return "0 min";
  if (hh === 0) return `${mm} min`;
  if (mm === 0) return `${hh} h`;
  return `${hh} h ${mm} min`;
}
function balanceClass(h) {
  if (h === null || h === undefined || isNaN(h)) return "zero";
  if (h > 0.01) return "positive";
  if (h < -0.01) return "negative";
  return "zero";
}
function netHours(entrata, uscita) {
  const e = parseTimeToMinutes(entrata);
  const u = parseTimeToMinutes(uscita);
  if (e === null || u === null) return null;
  return (u - e) / 60 - PAUSA_HOURS;
}

/* ---------------- day stats ---------------- */
function dayStats(entry, year, month, day, now) {
  const sw = !!entry.sw;
  const ferieHours = Math.max(0, Math.min(TARGET_HOURS, Number(entry.ferie) || 0));
  const isFerie = ferieHours > 0;
  const entrata = sw ? SW_ENTRATA : (entry.entrata || "");
  const uscita = sw ? SW_USCITA : (entry.uscita || "");
  const commessa = (entry.commessa || "").trim();
  const effectiveTarget = TARGET_HOURS - ferieHours;

  let status = "empty", netH = null, scarto = null, anomaly = false;

  if (ferieHours >= TARGET_HOURS) {
    status = "full";
    scarto = 0;
  } else if (entrata && uscita) {
    status = "full";
    netH = netHours(entrata, uscita);
    scarto = netH - effectiveTarget;
  } else if (entrata || uscita) {
    status = "partial";
    const dateObj = new Date(year, month, day);
    dateObj.setHours(0, 0, 0, 0);
    const todayObj = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (dateObj < todayObj && entrata && !uscita) {
      anomaly = true;
      scarto = -effectiveTarget;
    }
  } else if (isFerie) {
    status = "partial";
    scarto = -effectiveTarget;
  }

  return { status, entrata, uscita, netH, scarto, anomaly, isFerie, ferieHours, sw, commessa };
}

function monthSummary(data, year, month, now) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let scarto = 0, worked = 0, ferie = 0, ferieHours = 0, sw = 0, workdays = 0, workedHours = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month, d).getDay();
    if (dow !== 0 && dow !== 6) workdays++;
    const ds = dayStats(getDay(data, year, month, d), year, month, d, now);
    if (ds.scarto !== null) scarto += ds.scarto;
    if (ds.status === "full") worked++;
    if (ds.isFerie) ferie++;
    if (ds.ferieHours) ferieHours += ds.ferieHours;
    if (ds.sw) sw++;
    if (ds.netH !== null) workedHours += ds.netH;
  }
  const expectedHours = workdays * TARGET_HOURS - ferieHours;
  return { scarto, worked, ferie, ferieHours, sw, daysInMonth, workdays, expectedHours, workedHours };
}

function buildSeries(data, fromDate, toDate, now) {
  const series = [];
  const cur = new Date(fromDate);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(toDate);
  end.setHours(0, 0, 0, 0);
  while (cur <= end) {
    const y = cur.getFullYear(), m = cur.getMonth(), d = cur.getDate();
    const ds = dayStats(getDay(data, y, m, d), y, m, d, now);
    series.push({
      date: new Date(cur),
      label: `${d}/${m + 1}`,
      scarto: (ds.status === "full" || ds.anomaly) ? ds.scarto : null,
      status: ds.status,
      anomaly: ds.anomaly,
    });
    cur.setDate(cur.getDate() + 1);
  }
  return series;
}

/* ---------------- tabs ---------------- */
function initTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
      btn.classList.add("active");
      $(`view-${btn.dataset.view}`).classList.add("active");
      if (btn.dataset.view === "stats") renderStats();
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
  const now = new Date();
  const data = loadData();
  $("todayDate").textContent = now.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });

  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const entry = getDay(data, y, m, d);
  const ds = dayStats(entry, y, m, d, now);

  const entrataStr = ds.entrata;
  const uscitaStr = ds.uscita;

  const entPill = $("entrataPill"), uscPill = $("uscitaPill");
  $("entrataValue").textContent = entrataStr || "--:--";
  $("uscitaValue").textContent = uscitaStr || "--:--";
  entPill.classList.toggle("empty", !entrataStr);
  uscPill.classList.toggle("empty", !uscitaStr);

  let workedHours = null;
  if (ds.status === "full") {
    workedHours = ds.netH;
  } else if (entrataStr) {
    const entMin = parseTimeToMinutes(entrataStr);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    workedHours = Math.max(0, minutesToHours(nowMin - entMin) - PAUSA_HOURS);
  }
  renderRing(workedHours);

  $("btnEntrata").disabled = !!entrataStr;
  $("btnUscita").disabled = !entrataStr || !!uscitaStr;
  $("btnEntrata").textContent = entrataStr ? "✓ Entrata timbrata" : "▶ Timbra entrata";
  $("btnUscita").textContent = uscitaStr ? "✓ Uscita timbrata" : "⏹ Timbra uscita";
}

function renderBalances() {
  const now = new Date();
  const data = loadData();

  const monthInfo = monthSummary(data, now.getFullYear(), now.getMonth(), now);
  $("monthBalance").textContent = fmtHoursMin(monthInfo.scarto);
  $("monthBalance").className = "value " + balanceClass(monthInfo.scarto);
  $("monthBalanceSub").textContent = `${monthInfo.worked} giorni lavorati`;

  let yearScarto = 0, yearWorked = 0;
  for (let mIdx = 0; mIdx <= now.getMonth(); mIdx++) {
    const info = monthSummary(data, now.getFullYear(), mIdx, now);
    yearScarto += info.scarto;
    yearWorked += info.worked;
  }
  $("yearBalance").textContent = fmtHoursMin(yearScarto);
  $("yearBalance").className = "value " + balanceClass(yearScarto);
  $("yearBalanceSub").textContent = `${yearWorked} giorni totali`;

  const remaining = monthInfo.expectedHours - monthInfo.workedHours;
  $("expectedHours").textContent = fmtDuration(monthInfo.expectedHours);
  $("expectedHoursSub").textContent = monthInfo.ferieHours > 0
    ? `${monthInfo.workdays} giorni lavorativi · -${fmtDuration(monthInfo.ferieHours)} ferie · mancano ${fmtDuration(Math.max(0, remaining))}`
    : `${monthInfo.workdays} giorni lavorativi · mancano ${fmtDuration(Math.max(0, remaining))}`;
}

function renderLast7() {
  const now = new Date();
  const data = loadData();
  const from = new Date(now);
  from.setDate(from.getDate() - 6);
  const series = buildSeries(data, from, now, now);

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
  const now = new Date();
  const data = loadData();
  const from = new Date(now);
  from.setDate(from.getDate() - 30);
  const series = buildSeries(data, from, now, now);
  const anomalies = series.filter((d) => d.anomaly);
  const el = $("anomalyBanner");
  if (!anomalies.length) { el.innerHTML = ""; return; }
  const last = anomalies[anomalies.length - 1];
  el.innerHTML = `<div class="banner"><span class="ic">⚠️</span>
    <span>Il <b>${last.label}</b> risulta un'entrata senza uscita registrata &mdash;
    controlla nel Calendario.</span></div>`;
}

/* ---------------- CALENDAR ---------------- */
function commessaList(data) {
  const set = new Set();
  Object.values(data).forEach((monthData) => {
    Object.values(monthData).forEach((entry) => {
      const c = (entry.commessa || "").trim();
      if (c && !/ferie/i.test(c)) set.add(c);
    });
  });
  return Array.from(set).sort();
}

function renderMonth() {
  const data = loadData();
  const now = new Date();
  const year = state.currentYear, month = state.currentMonth;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  $("monthLabel").textContent = `${MONTHS[month]} ${year}`;

  let worked = 0, partial = 0, html = "";

  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month, d).getDay();
    const wk = dow === 0 || dow === 6;
    const isToday = d === now.getDate() && month === now.getMonth() && year === now.getFullYear();
    const entry = getDay(data, year, month, d);
    const ds = dayStats(entry, year, month, d, now);

    let st = "empty", ic = "○";
    if (ds.ferieHours >= TARGET_HOURS) { st = "ferie"; ic = "🌴"; worked++; }
    else if (ds.status === "full") { st = "full"; ic = "✓"; worked++; }
    else if (ds.status === "partial") { st = "partial"; ic = "◐"; partial++; }

    let pillClass = "neutral", pillText = "";
    if (ds.scarto !== null) {
      pillClass = ds.scarto > 0.01 ? "positive" : ds.scarto < -0.01 ? "negative" : "neutral";
      pillText = fmtHoursMin(ds.scarto);
    }

    const entVal = padTime(entry.sw ? SW_ENTRATA : (entry.entrata || ""));
    const uscVal = padTime(entry.sw ? SW_USCITA : (entry.uscita || ""));
    const commessaVal = (entry.commessa || "");
    const ferieHours = ds.ferieHours;
    const lockTimes = entry.sw || ferieHours >= TARGET_HOURS;

    html += `<div class="day-row ${isToday ? "today" : ""} ${wk ? "weekend" : ""} ${ds.anomaly ? "anomaly" : ""}" data-day="${d}">
      <div class="day-row-main">
        <div class="day-info"><div class="day-num">${d}</div><span class="day-name">${DAY_NAMES[dow]}</span></div>
        <div class="inp-group"><label>Entrata</label>
          <input type="text" inputmode="numeric" placeholder="--:--" maxlength="5" value="${entVal}" data-day="${d}" data-field="entrata" class="time-inp" ${lockTimes ? "disabled" : ""}>
        </div>
        <div class="inp-group"><label>Uscita</label>
          <input type="text" inputmode="numeric" placeholder="--:--" maxlength="5" value="${uscVal}" data-day="${d}" data-field="uscita" class="time-inp" ${lockTimes ? "disabled" : ""}>
        </div>
        <div class="status-dot ${st}">${ic}</div>
      </div>
      <div class="day-row-extra">
        <label class="sw-toggle"><input type="checkbox" data-day="${d}" data-field="sw" ${entry.sw ? "checked" : ""}><span>SW</span></label>
        <label class="sw-toggle"><input type="checkbox" data-day="${d}" data-field="ferie" ${ferieHours > 0 ? "checked" : ""}><span>Ferie</span></label>
        ${ferieHours > 0 ? `<input type="number" class="ferie-inp" min="0.5" max="${TARGET_HOURS}" step="0.5" value="${ferieHours}" data-day="${d}" data-field="ferieHours">` : ""}
        <input type="text" class="commessa-inp" list="commessaList" placeholder="Commessa" value="${commessaVal}" data-day="${d}" data-field="commessa">
        ${pillText ? `<div class="scarto-pill ${pillClass}">${pillText}</div>` : ""}
      </div>
    </div>`;
  }

  $("daysContainer").innerHTML = html;
  renderCommessaDatalist(data);

  const totalScarto = monthSummary(data, year, month, now).scarto;
  $("statsStrip").innerHTML = `
    <div class="stat-chip"><div class="sc-label">Completati</div><div class="sc-value" style="color:var(--green)">${worked}</div></div>
    <div class="stat-chip"><div class="sc-label">Parziali</div><div class="sc-value" style="color:var(--orange)">${partial}</div></div>
    <div class="stat-chip"><div class="sc-label">Progresso</div><div class="sc-value" style="color:var(--accent)">${Math.round(((worked + partial * 0.3) / daysInMonth) * 100)}%</div></div>
    <div class="stat-chip"><div class="sc-label">Saldo mese</div><div class="sc-value ${balanceClass(totalScarto)}">${fmtHoursMin(totalScarto)}</div></div>`;

  document.querySelectorAll(".time-inp").forEach((inp) => {
    inp.addEventListener("focus", (e) => e.target.select());
    inp.addEventListener("input", formatTimeInput);
    inp.addEventListener("change", onTimeChange);
  });
  document.querySelectorAll('input[data-field="sw"]').forEach((inp) => {
    inp.addEventListener("change", onSwChange);
  });
  document.querySelectorAll('input[data-field="ferie"]').forEach((inp) => {
    inp.addEventListener("change", onFerieToggle);
  });
  document.querySelectorAll('input[data-field="ferieHours"]').forEach((inp) => {
    inp.addEventListener("change", onFerieHoursChange);
  });
  document.querySelectorAll(".commessa-inp").forEach((inp) => {
    inp.addEventListener("change", onCommessaChange);
  });

  if (now.getDate() <= daysInMonth && month === now.getMonth() && year === now.getFullYear()) {
    setTimeout(() => {
      const el = document.querySelector(".day-row.today");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
  }
}

function renderCommessaDatalist(data) {
  let dl = $("commessaList");
  if (!dl) {
    dl = document.createElement("datalist");
    dl.id = "commessaList";
    document.body.appendChild(dl);
  }
  dl.innerHTML = commessaList(data).map((c) => `<option value="${c}"></option>`).join("");
}

function onTimeChange(e) {
  const inp = e.target;
  const d = parseInt(inp.dataset.day, 10), field = inp.dataset.field, value = inp.value.trim();

  if (value && !isValidTime(value)) {
    showToast("⚠️ Formato ora non valido (HH:MM)", true);
    renderMonth();
    return;
  }

  const finalValue = value ? padTime(value) : "";
  setDayField(state.currentYear, state.currentMonth, d, field, finalValue);

  if (field === "entrata" && finalValue) {
    const entry = getDay(loadData(), state.currentYear, state.currentMonth, d);
    if (!entry.uscita) {
      const suggestion = addMinutesToTime(finalValue, (TARGET_HOURS + PAUSA_HOURS) * 60);
      setDayField(state.currentYear, state.currentMonth, d, "uscita", suggestion);
    }
  }

  renderMonth();
  refreshAfterEdit();
  showToast("✅ Salvato");
}

function onSwChange(e) {
  const inp = e.target;
  const d = parseInt(inp.dataset.day, 10);
  setDayField(state.currentYear, state.currentMonth, d, "sw", inp.checked);
  renderMonth();
  refreshAfterEdit();
  showToast(inp.checked ? "✅ Smart working impostato (7:45-16:30)" : "✅ Salvato");
}

function onFerieToggle(e) {
  const inp = e.target;
  const d = parseInt(inp.dataset.day, 10);
  setDayField(state.currentYear, state.currentMonth, d, "ferie", inp.checked ? TARGET_HOURS : 0);
  renderMonth();
  refreshAfterEdit();
  showToast(inp.checked ? "✅ Ferie impostate (giornata intera)" : "✅ Salvato");
}

function onFerieHoursChange(e) {
  const inp = e.target;
  const d = parseInt(inp.dataset.day, 10);
  let val = parseFloat(inp.value);
  if (isNaN(val) || val <= 0) val = 0;
  if (val > TARGET_HOURS) val = TARGET_HOURS;
  setDayField(state.currentYear, state.currentMonth, d, "ferie", val);
  renderMonth();
  refreshAfterEdit();
  showToast("✅ Salvato");
}

function onCommessaChange(e) {
  const inp = e.target;
  const d = parseInt(inp.dataset.day, 10);
  setDayField(state.currentYear, state.currentMonth, d, "commessa", inp.value.trim());
  renderMonth();
  refreshAfterEdit();
  showToast("✅ Salvato");
}

function refreshAfterEdit() {
  const now = new Date();
  if (state.currentMonth === now.getMonth() && state.currentYear === now.getFullYear()) {
    renderToday();
  }
  renderBalances();
  renderLast7();
  renderAnomalyBanner();
}

function changeMonth(delta) {
  state.currentMonth += delta;
  if (state.currentMonth < 0) { state.currentMonth = 11; state.currentYear--; }
  if (state.currentMonth > 11) { state.currentMonth = 0; state.currentYear++; }
  renderMonth();
}

/* ---------------- EXPORT MARKDOWN ---------------- */
async function downloadFile(filename, content) {
  const blob = new Blob([content], { type: "text/markdown" });

  if (navigator.canShare && navigator.share) {
    try {
      const file = new File([blob], filename, { type: "text/markdown" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        showToast("📄 Esportato in Markdown");
        return;
      }
    } catch (err) {
      if (err && err.name === "AbortError") return;
      // se la condivisione non è supportata, prosegui con il download
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`📄 Scaricato "${filename}" (controlla la cartella Download)`);
}

function exportMonthToMarkdown() {
  const data = loadData();
  const now = new Date();
  const year = state.currentYear, month = state.currentMonth;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let md = `# Timbrature - ${MONTHS[month]} ${year}\n\n`;
  md += `| Giorno | Entrata | Uscita | SW | Ferie | Commessa | Ore | Scarto |\n`;
  md += `|---|---|---|---|---|---|---|---|\n`;

  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month, d).getDay();
    const entry = getDay(data, year, month, d);
    const ds = dayStats(entry, year, month, d, now);
    const ore = ds.netH !== null ? ds.netH.toFixed(2) + "h" : "—";
    const scarto = ds.scarto !== null ? fmtHoursMin(ds.scarto) : "—";
    const ferie = ds.ferieHours ? ds.ferieHours + "h" : "";
    md += `| ${d} (${DAY_NAMES[dow]}) | ${ds.entrata || "—"} | ${ds.uscita || "—"} | ${ds.sw ? "✓" : ""} | ${ferie} | ${ds.commessa || ""} | ${ore} | ${scarto} |\n`;
  }

  const summary = monthSummary(data, year, month, now);
  md += `\n**Totale scarto mese:** ${fmtHoursMin(summary.scarto)}\n`;
  md += `\n**Giorni lavorati:** ${summary.worked} · **Ferie:** ${summary.ferie} (${fmtDuration(summary.ferieHours)}) · **Smart working:** ${summary.sw}\n`;
  md += `\n**Ore lavorative previste (al netto ferie):** ${fmtDuration(summary.expectedHours)}\n`;

  downloadFile(`timbrature-${monthKey(year, month)}.md`, md);
}

/* ---------------- STATS ---------------- */
function renderStats() {
  const now = new Date();
  const data = loadData();

  // monthly bar chart (Gennaio -> mese corrente)
  const labels = [];
  const values = [];
  for (let mIdx = 0; mIdx <= now.getMonth(); mIdx++) {
    labels.push(MONTHS[mIdx].slice(0, 3));
    values.push(monthSummary(data, now.getFullYear(), mIdx, now).scarto);
  }
  const colors = values.map((v) => v > 0 ? "#34d399" : v < 0 ? "#f87171" : "#6b6b8a");
  if (state.charts.monthly) state.charts.monthly.destroy();
  state.charts.monthly = new Chart($("monthlyChart"), {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmtHoursMin(c.raw) } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#9494b0", font: { size: 10 } } },
        y: { grid: { color: "#22222f" }, ticks: { color: "#9494b0", font: { size: 10 } } },
      },
    },
  });

  // monthly hours chart, proportioned: lavorate / ferie / rimanenti vs ore previste
  const hoursLabels = [];
  const workedData = [], ferieData = [], remainingData = [];
  for (let mIdx = 0; mIdx <= now.getMonth(); mIdx++) {
    const info = monthSummary(data, now.getFullYear(), mIdx, now);
    const expectedGross = info.workdays * TARGET_HOURS;
    const worked = Math.min(info.workedHours, expectedGross);
    const ferieH = Math.min(info.ferieHours, expectedGross - worked);
    const remaining = Math.max(0, expectedGross - worked - ferieH);
    hoursLabels.push(MONTHS[mIdx].slice(0, 3));
    workedData.push(Math.round(worked * 100) / 100);
    ferieData.push(Math.round(ferieH * 100) / 100);
    remainingData.push(Math.round(remaining * 100) / 100);
  }
  if (state.charts.hours) state.charts.hours.destroy();
  state.charts.hours = new Chart($("hoursChart"), {
    type: "bar",
    data: {
      labels: hoursLabels,
      datasets: [
        { label: "Lavorate", data: workedData, backgroundColor: "#8b5cf6", borderRadius: 4 },
        { label: "Ferie", data: ferieData, backgroundColor: "#fbbf24", borderRadius: 4 },
        { label: "Rimanenti", data: remainingData, backgroundColor: "#2a2a3d", borderRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtDuration(c.raw)}` } },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: "#9494b0", font: { size: 10 } } },
        y: { stacked: true, grid: { color: "#22222f" }, ticks: { color: "#9494b0", font: { size: 10 } } },
      },
    },
  });
  $("hoursLegend").innerHTML = `
    <span><span class="legend-dot" style="background:#8b5cf6"></span>Lavorate</span>
    <span><span class="legend-dot" style="background:#fbbf24"></span>Ferie</span>
    <span><span class="legend-dot" style="background:#2a2a3d"></span>Rimanenti</span>`;

  // cumulative line chart (1 gennaio -> oggi)
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const series = buildSeries(data, yearStart, now, now);
  let cumulative = 0;
  const cumSeries = series.map((d) => {
    if (d.scarto !== null) cumulative += d.scarto;
    return { ...d, cumulative: Math.round(cumulative * 100) / 100 };
  });
  if (state.charts.cumulative) state.charts.cumulative.destroy();
  state.charts.cumulative = new Chart($("cumulativeChart"), {
    type: "line",
    data: {
      labels: cumSeries.map((d) => d.label),
      datasets: [{
        data: cumSeries.map((d) => d.cumulative),
        borderColor: "#8b5cf6",
        backgroundColor: "rgba(139,92,246,0.15)",
        fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmtHoursMin(c.raw) } } },
      scales: {
        x: { display: false },
        y: { grid: { color: "#22222f" }, ticks: { color: "#9494b0", font: { size: 10 } } },
      },
    },
  });

  // composition doughnut (1 gennaio -> oggi)
  let totalWorked = 0, totalFerie = 0, totalSw = 0;
  for (let mIdx = 0; mIdx <= now.getMonth(); mIdx++) {
    const info = monthSummary(data, now.getFullYear(), mIdx, now);
    totalWorked += info.worked;
    totalFerie += info.ferie;
    totalSw += info.sw;
  }
  const normal = Math.max(0, totalWorked - totalSw);
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
  let yearVal = 0;
  for (let mIdx = 0; mIdx <= now.getMonth(); mIdx++) {
    yearVal += monthSummary(data, now.getFullYear(), mIdx, now).scarto;
  }
  const scartoValues = series.filter((d) => d.status === "full").map((d) => d.scarto);
  const avg = scartoValues.length ? scartoValues.reduce((a, b) => a + b, 0) / scartoValues.length : 0;
  const worked = series.filter((d) => d.status === "full");
  const best = worked.reduce((max, d) => (max === null || d.scarto > max.scarto) ? d : max, null);
  const worst = worked.reduce((min, d) => (min === null || d.scarto < min.scarto) ? d : min, null);

  $("summaryGrid").innerHTML = `
    <div class="stat-chip"><div class="sc-label">Saldo anno</div><div class="sc-value ${balanceClass(yearVal)}">${fmtHoursMin(yearVal)}</div></div>
    <div class="stat-chip"><div class="sc-label">Giorni lavorati</div><div class="sc-value">${totalWorked}</div></div>
    <div class="stat-chip"><div class="sc-label">Media giornaliera</div><div class="sc-value ${balanceClass(avg)}">${fmtHoursMin(avg)}</div></div>
    <div class="stat-chip"><div class="sc-label">Giorni ferie</div><div class="sc-value" style="color:var(--orange)">${totalFerie}</div></div>
    <div class="stat-chip"><div class="sc-label">Miglior giorno</div><div class="sc-value positive">${best ? fmtHoursMin(best.scarto) + " (" + best.label + ")" : "—"}</div></div>
    <div class="stat-chip"><div class="sc-label">Peggior giorno</div><div class="sc-value negative">${worst ? fmtHoursMin(worst.scarto) + " (" + worst.label + ")" : "—"}</div></div>`;

  renderCommessaStats(data, now);
}

function commessaTotals(data, now, predicate) {
  const totals = {};
  Object.keys(data).forEach((mk) => {
    const [year, month1] = mk.split("-").map(Number);
    const month = month1 - 1;
    if (!predicate(year, month)) return;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const entry = getDay(data, year, month, d);
      const ds = dayStats(entry, year, month, d, now);
      if (ds.status === "full" && ds.ferieHours < TARGET_HOURS && ds.commessa) {
        totals[ds.commessa] = (totals[ds.commessa] || 0) + TARGET_HOURS;
      }
    }
  });
  return totals;
}

function renderCommessaList(elId, totals) {
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const el = $(elId);
  if (!entries.length) {
    el.innerHTML = `<div class="commessa-empty">Nessuna commessa registrata</div>`;
    return;
  }
  el.innerHTML = entries.map(([name, hours]) =>
    `<div class="commessa-row"><span class="commessa-name">${name}</span><span class="commessa-hours">${hours.toFixed(2)}h</span></div>`
  ).join("");
}

function renderCommessaStats(data, now) {
  const curYear = now.getFullYear(), curMonth = now.getMonth();
  const monthTotals = commessaTotals(data, now, (y, m) => y === curYear && m === curMonth);
  const yearTotals = commessaTotals(data, now, (y) => y === curYear);
  renderCommessaList("commessaStatsMonth", monthTotals);
  renderCommessaList("commessaStatsYear", yearTotals);
}

/* ---------------- bootstrap ---------------- */
function refreshAll() {
  renderToday();
  renderBalances();
  renderLast7();
  renderAnomalyBanner();
}

function quickStamp(field) {
  const now = new Date();
  const value = nowToTimeString();
  setDayField(now.getFullYear(), now.getMonth(), now.getDate(), field, value);
  showToast(`✅ ${field === "entrata" ? "Entrata" : "Uscita"} timbrata: ${value}`);
  refreshAll();
  if (state.currentMonth === now.getMonth() && state.currentYear === now.getFullYear()) renderMonth();
}

function init() {
  initTabs();
  startClock();

  const now = new Date();
  state.currentMonth = now.getMonth();
  state.currentYear = now.getFullYear();

  $("prevBtn").addEventListener("click", () => changeMonth(-1));
  $("nextBtn").addEventListener("click", () => changeMonth(1));
  $("exportBtn").addEventListener("click", exportMonthToMarkdown);
  $("btnEntrata").addEventListener("click", () => quickStamp("entrata"));
  $("btnUscita").addEventListener("click", () => quickStamp("uscita"));

  refreshAll();
  renderMonth();
  renderStats();

  setInterval(() => {
    renderToday();
  }, 30000);
}

init();
