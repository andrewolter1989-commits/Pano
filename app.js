const API_URL = "https://project-h2k76.vercel.app/api/calculate";
const RECIPIENTS_URL = "https://project-h2k76.vercel.app/api/recipients";

const state = {
  initialized: false,
  resultsByForwarder: {},
  recipientsById: {},
  lastRecipientMatches: []
};

const els = {
  form: document.getElementById("calculatorForm"),
  postalCode: document.getElementById("postalCode"),
  slots: document.getElementById("slots"),
  pallets: document.getElementById("pallets"),
  bookingWindow: document.getElementById("bookingWindow"),
  pickupDate: document.getElementById("pickupDate"),
  deliveryDate: document.getElementById("deliveryDate"),
  freeTextNote: document.getElementById("freeTextNote"),

  recipientSelect: document.getElementById("recipientSelect"),
  manualRecipientBox: document.getElementById("manualRecipientBox"),
  recipientName: document.getElementById("recipientName"),
  recipientStreet: document.getElementById("recipientStreet"),
  recipientCity: document.getElementById("recipientCity"),
  recipientCountry: document.getElementById("recipientCountry"),

  fatalError: document.getElementById("fatalError"),
  successNotice: document.getElementById("successNotice"),

  summaryBox: document.getElementById("summaryBox"),
  summaryPostal: document.getElementById("summaryPostal"),
  summaryCountry: document.getElementById("summaryCountry"),
  summaryPickupDate: document.getElementById("summaryPickupDate"),
  summaryDeliveryDate: document.getElementById("summaryDeliveryDate"),
  summarySlots: document.getElementById("summarySlots"),
  summaryPallets: document.getElementById("summaryPallets"),
  summaryBookingWindow: document.getElementById("summaryBookingWindow"),
  summaryFreeTextNote: document.getElementById("summaryFreeTextNote"),
  summaryRecipient: document.getElementById("summaryRecipient"),
  summaryCount: document.getElementById("summaryCount"),
  summaryBest: document.getElementById("summaryBest"),

  resultsSection: document.getElementById("resultsSection"),
  resultsBody: document.getElementById("resultsBody")
};

document.addEventListener("DOMContentLoaded", () => {
  els.slots.addEventListener("input", syncDerivedFieldsFromSlots);

  els.postalCode.addEventListener("blur", loadRecipientsForPostalCode);
  els.postalCode.addEventListener("change", loadRecipientsForPostalCode);

  els.recipientSelect.addEventListener("change", onRecipientSelectChange);

  syncDerivedFieldsFromSlots();
  state.initialized = true;

  els.form.addEventListener("submit", onSubmit);
  els.form.addEventListener("reset", onReset);
});

function syncDerivedFieldsFromSlots() {
  const slots = Number(els.slots.value);
  els.pallets.value = Math.ceil(slots);
}

async function loadRecipientsForPostalCode() {
  const postalCode = normalizePostalCode(els.postalCode.value);
  if (!postalCode) return;

  try {
    const response = await fetch(`${RECIPIENTS_URL}?postalCode=${postalCode}`);
    const data = await response.json();

    if (!data.ok) throw new Error(data.error);

    renderRecipientSelection(data.empfaengerMatches || []);
  } catch (err) {
    showFatal("Fehler beim Laden der Entladestellen");
  }
}

function renderRecipientSelection(matches) {
  const previousValue = els.recipientSelect.value;

  state.recipientsById = {};
  els.recipientSelect.innerHTML = "";

  matches.forEach((r, index) => {
    const id = r.id || `${r.plz}-${r.strasse}-${index}`;
    r.id = id;
    state.recipientsById[id] = r;
  });

  if (!matches.length) {
    els.recipientSelect.innerHTML = `<option value="manual">+ Neuer Empfänger</option>`;
    els.recipientSelect.value = "manual";
    els.manualRecipientBox.style.display = "grid";
    return;
  }

  if (matches.length === 1) {
    const r = matches[0];
    els.recipientSelect.innerHTML = `
      <option value="${r.id}" selected>${formatRecipientOption(r)}</option>
      <option value="manual">+ Neuer Empfänger</option>
    `;
    return;
  }

  els.recipientSelect.innerHTML = `
    <option value="">Bitte Entladestelle auswählen</option>
    ${matches.map(r => `<option value="${r.id}">${formatRecipientOption(r)}</option>`).join("")}
    <option value="manual">+ Neuer Empfänger</option>
  `;

  if (previousValue && state.recipientsById[previousValue]) {
    els.recipientSelect.value = previousValue;
  }
}

function onRecipientSelectChange() {
  els.manualRecipientBox.style.display =
    els.recipientSelect.value === "manual" ? "grid" : "none";
}

async function onSubmit(e) {
  e.preventDefault();

  const postalCode = normalizePostalCode(els.postalCode.value);

  if (!postalCode) {
    showFatal("Bitte eine PLZ eingeben.");
    return;
  }

  if (!els.recipientSelect.value) {
    showFatal("Bitte Entladestelle auswählen.");
    return;
  }

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postalCode,
        slots: Number(els.slots.value),
        pallets: Number(els.pallets.value),
        selectedRecipientId: els.recipientSelect.value
      })
    });

    const data = await response.json();

    if (!data.ok) throw new Error();

    showSuccess("Berechnung erfolgreich.");
  } catch {
    showFatal("Fehler bei Berechnung.");
  }
}

function normalizePostalCode(v) {
  return String(v || "").replace(/\s+/g, "").toUpperCase();
}

function formatRecipientOption(r) {
  return `${r.name1 || "Ohne Name"} – ${r.strasse} – ${r.plz} ${r.stadt} (${r.land})`;
}

function showFatal(t) {
  els.fatalError.textContent = t;
  els.fatalError.style.display = "block";
}

function showSuccess(t) {
  els.successNotice.textContent = t;
  els.successNotice.style.display = "block";
}

function onReset() {
  els.recipientSelect.innerHTML = `<option value="">Bitte PLZ eingeben</option>`;
  els.manualRecipientBox.style.display = "none";
}