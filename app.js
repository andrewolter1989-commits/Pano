const API_URL = "https://project-h2k76.vercel.app/api/calculate";

const state = {
  initialized: false,
  resultsByForwarder: {}
};

const els = {
  form: document.getElementById("calculatorForm"),
  postalCode: document.getElementById("postalCode"),
  slots: document.getElementById("slots"),
  pallets: document.getElementById("pallets"),
  bookingWindow: document.getElementById("bookingWindow"),
  bookingDate: document.getElementById("bookingDate"),
  freeTextNote: document.getElementById("freeTextNote"),
  fatalError: document.getElementById("fatalError"),
  summaryBox: document.getElementById("summaryBox"),
  summaryPostal: document.getElementById("summaryPostal"),
  summarySlots: document.getElementById("summarySlots"),
  summaryPallets: document.getElementById("summaryPallets"),
  summaryBookingWindow: document.getElementById("summaryBookingWindow"),
  summaryBookingDate: document.getElementById("summaryBookingDate"),
  summaryFreeTextNote: document.getElementById("summaryFreeTextNote"),
  summaryCount: document.getElementById("summaryCount"),
  summaryBest: document.getElementById("summaryBest"),
  resultsSection: document.getElementById("resultsSection"),
  resultsBody: document.getElementById("resultsBody")
};

document.addEventListener("DOMContentLoaded", () => {
  els.slots.addEventListener("input", syncDerivedFieldsFromSlots);
  syncDerivedFieldsFromSlots();

  state.initialized = true;

  els.form.addEventListener("submit", onSubmit);
  els.form.addEventListener("reset", onReset);
});

function syncDerivedFieldsFromSlots() {
  const slots = Number(els.slots.value);
  const pallets = Math.ceil(slots);
  els.pallets.value = Number.isFinite(pallets) ? String(pallets) : "";
}

function normalizePostalCode(value) {
  return String(value || "").toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9]/g, "");
}

function formatMoney(value) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value || 0);
}

function formatPercent(value) {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format((value || 0) * 100) + " %";
}

function formatDisplayDate(value) {
  if (!value) return "—";
  const [year, month, day] = String(value).split("-");
  return `${day}.${month}.${year}`;
}

function showFatal(text) {
  els.fatalError.textContent = text;
  els.fatalError.style.display = "block";
}

function clearFatal() {
  els.fatalError.style.display = "none";
}

function onReset() {
  setTimeout(() => {
    clearFatal();
    state.resultsByForwarder = {};
    els.summaryBox.style.display = "none";
    els.resultsSection.style.display = "none";
    els.resultsBody.innerHTML = `<tr><td colspan="8">Noch keine Berechnung.</td></tr>`;
  }, 0);
}

async function onSubmit(event) {
  event.preventDefault();
  clearFatal();

  const postalCode = normalizePostalCode(els.postalCode.value);
  const slots = Number(els.slots.value);
  const pallets = Number(els.pallets.value);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ postalCode, slots, pallets })
    });

    const data = await response.json();
renderRecipientSelection(data.empfaengerMatches || []);

    if (!data.ok) throw new Error(data.error);

    renderResults(data.results);

  } catch (e) {
    showFatal("Fehler beim Backend: " + e.message);
  }
}

function renderResults(results) {
  els.resultsSection.style.display = "block";
  els.resultsBody.innerHTML = "";

  results.forEach((row, i) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${row.forwarder}</td>
      <td>${row.zone}</td>
      <td>${formatMoney(row.basePrice)}</td>
      <td>${formatPercent(row.floaterRate)}</td>
      <td>${formatMoney(row.floaterEuro)}</td>
      <td>${formatMoney(row.ancillaryCharge)}</td>
      <td>${formatMoney(row.totalPrice)}</td>
      <td>${row.email || ""}</td>
    `;

    els.resultsBody.appendChild(tr);
  });
}
function renderRecipientSelection(matches) {
  const select = document.getElementById("recipientSelect");
  const manualBox = document.getElementById("manualRecipientBox");

  select.innerHTML = "";

  if (!matches.length) {
    select.innerHTML = `<option value="manual">+ Neuer Empfänger</option>`;
    manualBox.style.display = "block";
    return;
  }

  if (matches.length === 1) {
    const r = matches[0];
    select.innerHTML = `
      <option value="${r.id}">
        ${r.name1} – ${r.strasse} – ${r.plz} ${r.stadt}
      </option>
      <option value="manual">+ Neuer Empfänger</option>
    `;
    manualBox.style.display = "none";
    return;
  }

  select.innerHTML = `
    <option value="">Bitte auswählen</option>
    ${matches.map(r => `
      <option value="${r.id}">
        ${r.name1} – ${r.strasse} – ${r.plz} ${r.stadt}
      </option>
    `).join("")}
    <option value="manual">+ Neuer Empfänger</option>
  `;

  manualBox.style.display = "none";
}

document.getElementById("recipientSelect").addEventListener("change", (e) => {
  document.getElementById("manualRecipientBox").style.display =
    e.target.value === "manual" ? "block" : "none";
});