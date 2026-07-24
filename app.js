/* Tsuki Clover Tracker — app logic
   Everything lives in localStorage. No network calls, no accounts. */

(function () {
  "use strict";

  const STORAGE_KEY = "tsukiCloverTracker.v1";
  const COLORS = {
    four: "#8FBC7A",
    sixteen: "#4F7942",
    sixtyfour: "#D4A72C",
    baby: "#BFD8A0"
  };

  // ---------- state ----------
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { history: [] };
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.history)) return { history: [] };
      return parsed;
    } catch (e) {
      console.error("Failed to load data", e);
      return { history: [] };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error("Failed to save data", e);
      toast("⚠️ Couldn't save — your browser is blocking storage for this page.");
    }
  }

  let state = loadState();

  function makeId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function formatDateNice(dateStr) {
    // dateStr: YYYY-MM-DD -> "19 July 2026"
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  }

  function formatDateShort(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }

  // ---------- totals engine ----------
  function computeTotals(history) {
    const sorted = [...history].sort((a, b) => a.ts - b.ts);
    let totals = { four: 0, sixteen: 0, sixtyfour: 0, babies: 0 };
    for (const e of sorted) {
      if (e.type === "production") {
        totals.babies += e.production.babies || 0;
        totals.four += e.production.four || 0;
        totals.sixteen += e.production.sixteen || 0;
        totals.sixtyfour += e.production.sixtyfour || 0;
      } else if (e.type === "maturity") {
        const consumed = (e.maturity.four || 0) + (e.maturity.sixteen || 0) + (e.maturity.sixtyfour || 0);
        totals.babies = Math.max(0, totals.babies - consumed);
        totals.four += e.maturity.four || 0;
        totals.sixteen += e.maturity.sixteen || 0;
        totals.sixtyfour += e.maturity.sixtyfour || 0;
      } else if (e.type === "override") {
        totals = {
          four: e.override.four || 0,
          sixteen: e.override.sixteen || 0,
          sixtyfour: e.override.sixtyfour || 0,
          babies: e.override.babies || 0
        };
      }
    }
    return totals;
  }

  function currentTotals() {
    return computeTotals(state.history);
  }

  function lastUpdatedLabel() {
    if (state.history.length === 0) return "Last updated: —";
    const sorted = [...state.history].sort((a, b) => b.ts - a.ts);
    return "Last updated: " + formatDateNice(sorted[0].date);
  }

  // ---------- navigation ----------
  const views = ["dashboard", "add-production", "mature-babies", "statistics", "history", "calculator", "settings"];

  function goTo(viewName) {
    views.forEach((v) => {
      document.getElementById("view-" + v).classList.toggle("active", v === viewName);
    });
    document.querySelectorAll("nav.bottom button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.nav === viewName);
    });
    if (viewName === "add-production") prepAddProduction();
    if (viewName === "mature-babies") prepMatureBabies();
    if (viewName === "statistics") renderStatistics();
    if (viewName === "history") renderHistory();
    if (viewName === "calculator") prepCalculator();
    if (viewName === "dashboard") renderDashboard();
    window.scrollTo(0, 0);
  }

  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => goTo(el.dataset.nav));
  });

  // ---------- toast ----------
  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  // ---------- steppers ----------
  function getVal(id) {
    return parseInt(document.getElementById(id).textContent, 10) || 0;
  }
  function setVal(id, v) {
    document.getElementById(id).textContent = String(Math.max(0, v));
  }

  function wireSteppers(containerSelector, onChange) {
    document.querySelectorAll(containerSelector + " .stepper").forEach((stepperEl) => {
      const targetId = stepperEl.dataset.target;
      stepperEl.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", () => {
          const step = parseInt(btn.dataset.step, 10);
          const cur = getVal(targetId);
          const allowed = onChange ? onChange(targetId, cur, step) : cur + step;
          setVal(targetId, allowed);
        });
      });
    });
  }

  // Add Production steppers — unrestricted (min 0)
  wireSteppers("#view-add-production", (id, cur, step) => cur + step);

  // Mature Babies steppers — cannot exceed available babies in total
  wireSteppers("#view-mature-babies", (id, cur, step) => {
    if (step > 0) {
      const available = currentTotals().babies;
      const sumOthers = ["mb-four", "mb-sixteen", "mb-sixtyfour"]
        .filter((x) => x !== id)
        .reduce((acc, x) => acc + getVal(x), 0);
      if (sumOthers + cur + step > available) {
        flashMatureError();
        return cur;
      }
    }
    return cur + step;
  });

  function flashMatureError() {
    const box = document.getElementById("mb-error");
    box.classList.add("show");
    setTimeout(() => box.classList.remove("show"), 1600);
  }

  document.querySelectorAll("#view-mature-babies .stepper button").forEach((btn) => {
    btn.addEventListener("click", updateMatureRemaining);
  });
  function updateMatureRemaining() {
    const available = currentTotals().babies;
    const assigned = getVal("mb-four") + getVal("mb-sixteen") + getVal("mb-sixtyfour");
    document.getElementById("mb-remaining").textContent = Math.max(0, available - assigned);
  }

  // Farm Calculator steppers — unrestricted hypothetical numbers, min 0
  wireSteppers("#view-calculator", (id, cur, step) => cur + step);
  document.querySelectorAll("#view-calculator .stepper button").forEach((btn) => {
    btn.addEventListener("click", renderCalculatorResults);
  });

  // ---------- dashboard ----------
  function renderDashboard() {
    const t = currentTotals();
    document.getElementById("d-four").textContent = t.four;
    document.getElementById("d-sixteen").textContent = t.sixteen;
    document.getElementById("d-sixtyfour").textContent = t.sixtyfour;
    document.getElementById("d-babies").textContent = t.babies;
    document.getElementById("d-mature-total").textContent = t.four + t.sixteen + t.sixtyfour;
    document.getElementById("d-grand-total").textContent = t.four + t.sixteen + t.sixtyfour + t.babies;
    document.getElementById("d-updated").textContent = lastUpdatedLabel();
    document.getElementById("btn-undo").style.display = state.history.length ? "flex" : "none";
  }

  // ---------- add production ----------
  function prepAddProduction() {
    document.getElementById("ap-date").value = todayStr();
    ["ap-babies", "ap-four", "ap-sixteen", "ap-sixtyfour"].forEach((id) => setVal(id, 0));
    document.getElementById("ap-notes").value = "";
  }

  document.getElementById("ap-save").addEventListener("click", () => {
    const babies = getVal("ap-babies");
    const four = getVal("ap-four");
    const sixteen = getVal("ap-sixteen");
    const sixtyfour = getVal("ap-sixtyfour");
    if (babies + four + sixteen + sixtyfour === 0) {
      toast("Add at least one clover before saving.");
      return;
    }
    const date = document.getElementById("ap-date").value || todayStr();
    const notes = document.getElementById("ap-notes").value.trim();
    state.history.push({
      id: makeId(),
      ts: Date.now(),
      date,
      type: "production",
      production: { babies, four, sixteen, sixtyfour },
      notes
    });
    saveState();
    toast("Production saved 🌱");
    goTo("dashboard");
  });

  // ---------- mature babies ----------
  function prepMatureBabies() {
    ["mb-four", "mb-sixteen", "mb-sixtyfour"].forEach((id) => setVal(id, 0));
    document.getElementById("mb-error").classList.remove("show");
    document.getElementById("mb-available").textContent = currentTotals().babies;
    updateMatureRemaining();
  }

  document.getElementById("mb-save").addEventListener("click", () => {
    const four = getVal("mb-four");
    const sixteen = getVal("mb-sixteen");
    const sixtyfour = getVal("mb-sixtyfour");
    const total = four + sixteen + sixtyfour;
    const available = currentTotals().babies;
    if (total === 0) {
      toast("Assign at least one baby clover.");
      return;
    }
    if (total > available) {
      flashMatureError();
      return;
    }
    state.history.push({
      id: makeId(),
      ts: Date.now(),
      date: todayStr(),
      type: "maturity",
      maturity: { four, sixteen, sixtyfour },
      notes: ""
    });
    saveState();
    toast("Babies matured ✨");
    goTo("dashboard");
  });

  // ---------- farm calculator ----------
  // Official formulas from the Tsuki's Odyssey wiki (Clovers page):
  //   W  = n4 + 16*n16 + 256*n64                    (weighted clover score)
  //   Es = (1 + log2(W + 1)) * 0.15                 (strange rate, in %)
  //   T  = n4 + n16 + n64                           (total clovers placed)
  //   Et = 2047 / (T^3 + 2047) * 100                (farm speed, in %)
  function computeFarmEffects(n4, n16, n64) {
    const W = n4 + 16 * n16 + 256 * n64;
    const strangeRate = (1 + Math.log2(W + 1)) * 0.15;
    const T = n4 + n16 + n64;
    const farmSpeed = (2047 / (Math.pow(T, 3) + 2047)) * 100;
    return { W, T, strangeRate, farmSpeed };
  }

  function prepCalculator() {
    const t = currentTotals();
    setVal("calc-four", t.four);
    setVal("calc-sixteen", t.sixteen);
    setVal("calc-sixtyfour", t.sixtyfour);
    document.getElementById("calc-snap-four").textContent = t.four;
    document.getElementById("calc-snap-sixteen").textContent = t.sixteen;
    document.getElementById("calc-snap-sixtyfour").textContent = t.sixtyfour;
    document.getElementById("calc-snap-babies").textContent = t.babies;
    renderCalculatorResults();
  }

  function renderCalculatorResults() {
    const n4 = getVal("calc-four");
    const n16 = getVal("calc-sixteen");
    const n64 = getVal("calc-sixtyfour");
    const { W, T, strangeRate, farmSpeed } = computeFarmEffects(n4, n16, n64);
    document.getElementById("calc-strange").textContent = strangeRate.toFixed(2) + "%";
    document.getElementById("calc-speed").textContent = farmSpeed.toFixed(2) + "%";
    document.getElementById("calc-total").textContent = T;
    document.getElementById("calc-weight").textContent = W;
  }

  document.getElementById("calc-reset").addEventListener("click", () => {
    prepCalculator();
    toast("Reset to your current adults");
  });

  // ---------- override ----------
  const overrideModal = document.getElementById("override-modal");
  document.getElementById("btn-override").addEventListener("click", () => {
    const t = currentTotals();
    document.getElementById("ov-four").value = t.four;
    document.getElementById("ov-sixteen").value = t.sixteen;
    document.getElementById("ov-sixtyfour").value = t.sixtyfour;
    document.getElementById("ov-babies").value = t.babies;
    overrideModal.classList.add("show");
  });
  document.getElementById("ov-cancel").addEventListener("click", () => overrideModal.classList.remove("show"));
  document.getElementById("ov-save").addEventListener("click", () => {
    const clamp = (v) => Math.max(0, parseInt(v, 10) || 0);
    const four = clamp(document.getElementById("ov-four").value);
    const sixteen = clamp(document.getElementById("ov-sixteen").value);
    const sixtyfour = clamp(document.getElementById("ov-sixtyfour").value);
    const babies = clamp(document.getElementById("ov-babies").value);
    state.history.push({
      id: makeId(),
      ts: Date.now(),
      date: todayStr(),
      type: "override",
      override: { four, sixteen, sixtyfour, babies },
      notes: ""
    });
    saveState();
    overrideModal.classList.remove("show");
    toast("Totals updated");
    renderDashboard();
  });

  // ---------- undo ----------
  document.getElementById("btn-undo").addEventListener("click", () => {
    if (state.history.length === 0) return;
    const sorted = [...state.history].sort((a, b) => b.ts - a.ts);
    const last = sorted[0];
    if (!confirm("Undo the most recent action?\n\n" + describeEntry(last).replace(/<[^>]+>/g, ""))) return;
    state.history = state.history.filter((e) => e.id !== last.id);
    saveState();
    renderDashboard();
    toast("Last action undone");
  });

  // ---------- history ----------
  function describeEntry(e) {
    if (e.type === "production") {
      const parts = [];
      if (e.production.babies) parts.push(`+${e.production.babies} baby clover${e.production.babies > 1 ? "s" : ""}`);
      if (e.production.four) parts.push(`+${e.production.four} 4-leaf`);
      if (e.production.sixteen) parts.push(`+${e.production.sixteen} 16-leaf`);
      if (e.production.sixtyfour) parts.push(`+${e.production.sixtyfour} 64-leaf`);
      return "Production: " + (parts.join(", ") || "no change");
    }
    if (e.type === "maturity") {
      const total = e.maturity.four + e.maturity.sixteen + e.maturity.sixtyfour;
      const parts = [];
      if (e.maturity.four) parts.push(`+${e.maturity.four} 4-leaf`);
      if (e.maturity.sixteen) parts.push(`+${e.maturity.sixteen} 16-leaf`);
      if (e.maturity.sixtyfour) parts.push(`+${e.maturity.sixtyfour} 64-leaf`);
      return `Matured ${total} baby${total > 1 ? "s" : ""}: ` + parts.join(", ");
    }
    if (e.type === "override") {
      return `Manual override: set totals to 4-leaf ${e.override.four}, 16-leaf ${e.override.sixteen}, 64-leaf ${e.override.sixtyfour}, babies ${e.override.babies}`;
    }
    return "";
  }

  function renderHistory() {
    const list = document.getElementById("history-list");
    if (state.history.length === 0) {
      list.innerHTML = `<div class="empty-state"><span class="emoji">🌾</span>No history yet.<br>Add your first production entry to start your garden log.</div>`;
      return;
    }
    const sorted = [...state.history].sort((a, b) => b.ts - a.ts);
    list.innerHTML = sorted
      .map((e) => {
        const cls = e.type === "maturity" ? "maturity" : e.type === "override" ? "override" : "";
        return `
        <div class="history-entry ${cls}" data-id="${e.id}">
          <div class="date">${formatDateNice(e.date)}</div>
          <div class="desc">${describeEntry(e)}</div>
          ${e.notes ? `<div class="notes">"${escapeHtml(e.notes)}"</div>` : ""}
          <div class="row-actions">
            <button data-action="edit" data-id="${e.id}">Edit</button>
            <button data-action="delete" data-id="${e.id}">Delete</button>
          </div>
        </div>`;
      })
      .join("");

    list.querySelectorAll("[data-action='delete']").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!confirm("Delete this history entry? Totals will be recalculated.")) return;
        state.history = state.history.filter((e) => e.id !== btn.dataset.id);
        saveState();
        renderHistory();
        renderDashboard();
        toast("Entry deleted");
      });
    });
    list.querySelectorAll("[data-action='edit']").forEach((btn) => {
      btn.addEventListener("click", () => openEditModal(btn.dataset.id));
    });
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  // ---------- edit modal ----------
  const editModal = document.getElementById("edit-modal");
  const editModalContent = document.getElementById("edit-modal-content");

  function openEditModal(id) {
    const e = state.history.find((x) => x.id === id);
    if (!e) return;
    let fieldsHtml = "";
    if (e.type === "production") {
      fieldsHtml = `
        <label class="field-label">🌱 Babies</label>
        <input type="number" min="0" id="em-babies" value="${e.production.babies}">
        <label class="field-label">☘️ 4-leaf</label>
        <input type="number" min="0" id="em-four" value="${e.production.four}">
        <label class="field-label">🍀 16-leaf</label>
        <input type="number" min="0" id="em-sixteen" value="${e.production.sixteen}">
        <label class="field-label">✨ 64-leaf</label>
        <input type="number" min="0" id="em-sixtyfour" value="${e.production.sixtyfour}">
        <label class="field-label">Notes</label>
        <textarea id="em-notes">${escapeHtml(e.notes || "")}</textarea>
      `;
    } else if (e.type === "maturity") {
      fieldsHtml = `
        <label class="field-label">☘️ 4-leaf</label>
        <input type="number" min="0" id="em-four" value="${e.maturity.four}">
        <label class="field-label">🍀 16-leaf</label>
        <input type="number" min="0" id="em-sixteen" value="${e.maturity.sixteen}">
        <label class="field-label">✨ 64-leaf</label>
        <input type="number" min="0" id="em-sixtyfour" value="${e.maturity.sixtyfour}">
      `;
    } else if (e.type === "override") {
      fieldsHtml = `
        <label class="field-label">☘️ 4-leaf</label>
        <input type="number" min="0" id="em-four" value="${e.override.four}">
        <label class="field-label">🍀 16-leaf</label>
        <input type="number" min="0" id="em-sixteen" value="${e.override.sixteen}">
        <label class="field-label">✨ 64-leaf</label>
        <input type="number" min="0" id="em-sixtyfour" value="${e.override.sixtyfour}">
        <label class="field-label">🌱 Babies</label>
        <input type="number" min="0" id="em-babies" value="${e.override.babies}">
      `;
    }

    editModalContent.innerHTML = `
      <h2>Edit Entry</h2>
      <label class="field-label">Date</label>
      <input type="date" id="em-date" value="${e.date}">
      ${fieldsHtml}
      <div class="btn-row" style="margin-top:16px;">
        <button class="btn secondary" id="em-cancel">Cancel</button>
        <button class="btn" id="em-save">Save Changes</button>
      </div>
    `;
    editModal.classList.add("show");
    document.getElementById("em-cancel").addEventListener("click", () => editModal.classList.remove("show"));
    document.getElementById("em-save").addEventListener("click", () => {
      const clamp = (v) => Math.max(0, parseInt(v, 10) || 0);
      e.date = document.getElementById("em-date").value || e.date;
      if (e.type === "production") {
        e.production = {
          babies: clamp(document.getElementById("em-babies").value),
          four: clamp(document.getElementById("em-four").value),
          sixteen: clamp(document.getElementById("em-sixteen").value),
          sixtyfour: clamp(document.getElementById("em-sixtyfour").value)
        };
        e.notes = document.getElementById("em-notes").value.trim();
      } else if (e.type === "maturity") {
        e.maturity = {
          four: clamp(document.getElementById("em-four").value),
          sixteen: clamp(document.getElementById("em-sixteen").value),
          sixtyfour: clamp(document.getElementById("em-sixtyfour").value)
        };
      } else if (e.type === "override") {
        e.override = {
          four: clamp(document.getElementById("em-four").value),
          sixteen: clamp(document.getElementById("em-sixteen").value),
          sixtyfour: clamp(document.getElementById("em-sixtyfour").value),
          babies: clamp(document.getElementById("em-babies").value)
        };
      }
      saveState();
      editModal.classList.remove("show");
      renderHistory();
      renderDashboard();
      toast("Entry updated");
    });
  }

  // ---------- statistics ----------
  function groupProductionByDate() {
    const map = new Map();
    state.history
      .filter((e) => e.type === "production")
      .forEach((e) => {
        const cur = map.get(e.date) || { four: 0, sixteen: 0, sixtyfour: 0, babies: 0 };
        cur.four += e.production.four || 0;
        cur.sixteen += e.production.sixteen || 0;
        cur.sixtyfour += e.production.sixtyfour || 0;
        cur.babies += e.production.babies || 0;
        map.set(e.date, cur);
      });
    return map;
  }

  function groupMaturityByDate() {
    const map = new Map();
    state.history
      .filter((e) => e.type === "maturity")
      .forEach((e) => {
        const cur = map.get(e.date) || { four: 0, sixteen: 0, sixtyfour: 0 };
        cur.four += e.maturity.four || 0;
        cur.sixteen += e.maturity.sixteen || 0;
        cur.sixtyfour += e.maturity.sixtyfour || 0;
        map.set(e.date, cur);
      });
    return map;
  }

  function dailySnapshots() {
    const sorted = [...state.history].sort((a, b) => a.ts - b.ts);
    let totals = { four: 0, sixteen: 0, sixtyfour: 0, babies: 0 };
    const byDate = new Map();
    for (const e of sorted) {
      if (e.type === "production") {
        totals.babies += e.production.babies || 0;
        totals.four += e.production.four || 0;
        totals.sixteen += e.production.sixteen || 0;
        totals.sixtyfour += e.production.sixtyfour || 0;
      } else if (e.type === "maturity") {
        const consumed = (e.maturity.four || 0) + (e.maturity.sixteen || 0) + (e.maturity.sixtyfour || 0);
        totals.babies = Math.max(0, totals.babies - consumed);
        totals.four += e.maturity.four || 0;
        totals.sixteen += e.maturity.sixteen || 0;
        totals.sixtyfour += e.maturity.sixtyfour || 0;
      } else if (e.type === "override") {
        totals = { ...e.override };
      }
      byDate.set(e.date, { ...totals });
    }
    return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }

  function distinctDates() {
    return new Set(state.history.map((e) => e.date));
  }

  function longestStreak(dates) {
    const days = [...dates]
      .map((d) => {
        const [y, m, dd] = d.split("-").map(Number);
        return new Date(y, m - 1, dd).getTime();
      })
      .sort((a, b) => a - b);
    if (days.length === 0) return 0;
    let longest = 1, cur = 1;
    for (let i = 1; i < days.length; i++) {
      const diff = Math.round((days[i] - days[i - 1]) / 86400000);
      if (diff === 1) { cur += 1; }
      else if (diff === 0) { /* same day, ignore */ }
      else { cur = 1; }
      longest = Math.max(longest, cur);
    }
    return longest;
  }

  function renderStatistics() {
    const t = currentTotals();
    const producedByDate = groupProductionByDate();
    const maturedByDate = groupMaturityByDate();
    const dates = distinctDates();
    const daysTracked = dates.size;

    // "Total clovers created" = new clovers entering the farm at all (babies + any direct shop leaf)
    let totalCreated = 0;
    producedByDate.forEach((v) => {
      totalCreated += v.four + v.sixteen + v.sixtyfour + v.babies;
    });

    // Per-type rates & records come from maturing, since that's how leaf types actually appear day to day
    let sumFour = 0, sumSixteen = 0, sumSixtyfour = 0;
    let biggestDayVal = 0, biggestDayDate = null;
    let most64Val = 0, most64Date = null;
    maturedByDate.forEach((v, date) => {
      const dayTotal = v.four + v.sixteen + v.sixtyfour;
      sumFour += v.four; sumSixteen += v.sixteen; sumSixtyfour += v.sixtyfour;
      if (dayTotal > biggestDayVal) { biggestDayVal = dayTotal; biggestDayDate = date; }
      if (v.sixtyfour > most64Val) { most64Val = v.sixtyfour; most64Date = date; }
    });

    document.getElementById("s-days").textContent = daysTracked;
    document.getElementById("s-created").textContent = totalCreated;
    document.getElementById("s-mature").textContent = t.four + t.sixteen + t.sixtyfour;
    document.getElementById("s-babies").textContent = t.babies;

    const avg = (n) => (daysTracked ? (n / daysTracked).toFixed(1) : "0");
    document.getElementById("s-avg-all").textContent = avg(totalCreated);
    document.getElementById("s-avg-four").textContent = avg(sumFour);
    document.getElementById("s-avg-sixteen").textContent = avg(sumSixteen);
    document.getElementById("s-avg-sixtyfour").textContent = avg(sumSixtyfour);

    document.getElementById("s-record-day").textContent = biggestDayVal;
    document.getElementById("s-record-day").nextElementSibling.textContent =
      biggestDayDate ? `Biggest maturity day (${formatDateShort(biggestDayDate)})` : "Biggest maturity day";
    document.getElementById("s-record-64").textContent = most64Val;
    document.getElementById("s-record-64").nextElementSibling.textContent =
      most64Date ? `Most 64-leaf matured (${formatDateShort(most64Date)})` : "Most 64-leaf matured in a day";
    document.getElementById("s-record-streak").textContent = longestStreak(dates);

    // charts
    const dateKeys = [...maturedByDate.keys()].sort();
    drawStackedBarChart(
      "chart-daily",
      dateKeys.map(formatDateShort),
      [
        { color: COLORS.four, values: dateKeys.map((d) => maturedByDate.get(d).four) },
        { color: COLORS.sixteen, values: dateKeys.map((d) => maturedByDate.get(d).sixteen) },
        { color: COLORS.sixtyfour, values: dateKeys.map((d) => maturedByDate.get(d).sixtyfour) }
      ]
    );

    const babyDateKeys = [...producedByDate.keys()].sort();
    drawStackedBarChart(
      "chart-babies-daily",
      babyDateKeys.map(formatDateShort),
      [{ color: COLORS.baby, values: babyDateKeys.map((d) => producedByDate.get(d).babies) }]
    );

    const snaps = dailySnapshots();
    drawLineChart(
      "chart-growth",
      snaps.map(([d]) => formatDateShort(d)),
      [{ color: COLORS.sixteen, values: snaps.map(([, v]) => v.four + v.sixteen + v.sixtyfour) }]
    );
    drawLineChart(
      "chart-babies",
      snaps.map(([d]) => formatDateShort(d)),
      [{ color: COLORS.baby, values: snaps.map(([, v]) => v.babies) }]
    );
  }

  // ---------- canvas charts ----------
  function setupCanvas(id) {
    const canvas = document.getElementById(id);
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || canvas.parentElement.clientWidth;
    const h = 170;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function emptyChartMessage(ctx, w, h) {
    ctx.fillStyle = "#7A6647";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Not enough data yet", w / 2, h / 2);
  }

  // Picks a sensible whole-number axis scale (e.g. 0/1/2, 0/5/10/15, 0/25/50)
  // instead of dividing the raw max in half, which produces fractions like 2.5
  // that don't make sense for discrete clover counts.
  function niceAxisScale(maxVal, targetTicks) {
    targetTicks = targetTicks || 4;
    const safeMax = Math.max(1, maxVal);
    const rawStep = safeMax / targetTicks;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / mag;
    let niceNorm;
    if (norm <= 1) niceNorm = 1;
    else if (norm <= 2) niceNorm = 2;
    else if (norm <= 5) niceNorm = 5;
    else niceNorm = 10;
    const step = Math.max(1, Math.round(niceNorm * mag));
    const niceMax = Math.ceil(safeMax / step) * step;
    const ticks = [];
    for (let v = 0; v <= niceMax; v += step) ticks.push(v);
    return { niceMax, step, ticks };
  }

  function drawGridlines(ctx, w, chartH, padL, padT, ticks, niceMax) {
    ctx.strokeStyle = "#EADFC2";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#7A6647";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    ticks.forEach((tick) => {
      const y = padT + chartH - (tick / niceMax) * chartH;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.fillText(String(tick), padL - 4, y + 3);
    });
  }

  function drawStackedBarChart(id, labels, series) {
    const { ctx, w, h } = setupCanvas(id);
    if (labels.length === 0) return emptyChartMessage(ctx, w, h);
    const padL = 26, padB = 20, padT = 10;
    const chartH = h - padB - padT;
    const rawMax = Math.max(0, ...labels.map((_, i) => series.reduce((s, ser) => s + (ser.values[i] || 0), 0)));
    const { niceMax, ticks } = niceAxisScale(rawMax);
    const n = labels.length;
    const slot = (w - padL) / n;
    const barW = Math.min(28, slot * 0.6);

    drawGridlines(ctx, w, chartH, padL, padT, ticks, niceMax);

    labels.forEach((label, i) => {
      let yOffset = padT + chartH;
      const x = padL + slot * i + (slot - barW) / 2;
      series.forEach((ser) => {
        const v = ser.values[i] || 0;
        const barH = (v / niceMax) * chartH;
        ctx.fillStyle = ser.color;
        ctx.fillRect(x, yOffset - barH, barW, barH);
        yOffset -= barH;
      });
      if (n <= 10 || i % Math.ceil(n / 10) === 0) {
        ctx.fillStyle = "#7A6647";
        ctx.font = "9px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(label, x + barW / 2, padT + chartH + 14);
      }
    });
  }

  function drawLineChart(id, labels, series) {
    const { ctx, w, h } = setupCanvas(id);
    if (labels.length === 0) return emptyChartMessage(ctx, w, h);
    const padL = 26, padB = 20, padT = 10;
    const chartH = h - padB - padT;
    const rawMax = Math.max(0, ...series.flatMap((s) => s.values));
    const { niceMax, ticks } = niceAxisScale(rawMax);
    const n = labels.length;
    const stepX = n > 1 ? (w - padL) / (n - 1) : 0;

    drawGridlines(ctx, w, chartH, padL, padT, ticks, niceMax);

    series.forEach((ser) => {
      ctx.beginPath();
      ser.values.forEach((v, i) => {
        const x = padL + stepX * i;
        const y = padT + chartH - (v / niceMax) * chartH;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = ser.color;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      ctx.stroke();

      // fill under line
      ctx.lineTo(padL + stepX * (n - 1), padT + chartH);
      ctx.lineTo(padL, padT + chartH);
      ctx.closePath();
      ctx.fillStyle = ser.color + "33";
      ctx.fill();
    });

    ctx.fillStyle = "#7A6647";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "center";
    const labelEvery = Math.max(1, Math.ceil(n / 6));
    labels.forEach((label, i) => {
      if (i % labelEvery === 0 || i === n - 1) {
        ctx.fillText(label, padL + stepX * i, padT + chartH + 14);
      }
    });
  }

  // ---------- backup ----------
  document.getElementById("btn-export").addEventListener("click", () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      totals: currentTotals(),
      history: state.history
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = todayStr().replace(/-/g, "");
    a.href = url;
    a.download = `tsuki-clovers-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("Backup exported");
  });

  document.getElementById("btn-import").addEventListener("click", () => {
    document.getElementById("file-import").click();
  });
  document.getElementById("file-import").addEventListener("change", (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.history)) throw new Error("bad shape");
        if (!confirm("Import this backup? It will replace your current data.")) return;
        state.history = parsed.history;
        saveState();
        renderDashboard();
        toast("Backup imported");
        goTo("dashboard");
      } catch (e) {
        alert("That file doesn't look like a valid Tsuki Clover Tracker backup.");
      }
    };
    reader.readAsText(file);
    ev.target.value = "";
  });

  document.getElementById("btn-reset").addEventListener("click", () => {
    if (!confirm("Reset all data? This cannot be undone unless you have a backup.")) return;
    if (!confirm("Really sure? All history and totals will be permanently erased.")) return;
    state = { history: [] };
    saveState();
    renderDashboard();
    toast("All data cleared");
    goTo("dashboard");
  });

  // ---------- init ----------
  renderDashboard();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {
        /* offline-first still works via localStorage even if the service worker can't register,
           e.g. when opened directly from the filesystem instead of a hosted URL. */
      });
    });
  }
})();
