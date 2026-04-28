const API_URL = "https://project-h2k76.vercel.app/api/calculate";
const RECIPIENTS_URL = "https://project-h2k76.vercel.app/api/recipients";

const state = {
  initialized: false,
  resultsByForwarder: {},
  recipientsById: {}
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
  if (!els.pallets.matches(":focus")) {
    els.pallets.value = Number.isFinite(slots) ? String(Math.ceil(slots)) : "";
  }
}

async function loadRecipientsForPostalCode() {
  const postalCode = normalizePostalCode(els.postalCode.value);
  if (!postalCode) return;

  try {
    const response = await fetch(`${RECIPIENTS_URL}?postalCode=${encodeURIComponent(postalCode)}`);
    const data = await response.json();

    if (!response.ok || !data.ok) throw new Error(data.error || "Fehler");

    renderRecipientSelection(data.empfaengerMatches || []);
  } catch {
    showFatal("Entladestellen konnten nicht geladen werden.");
  }
}

function renderRecipientSelection(matches) {
  state.recipientsById = {};
  els.recipientSelect.innerHTML = "";

  matches.forEach((r, index) => {
    const id = String(r.id || `${r.plz}-${r.strasse}-${index}`);
    r.id = id;
    state.recipientsById[id] = r;
  });

  if (!matches.length) {
    els.recipientSelect.innerHTML = `<option value="manual">+ Neuer Empfänger</option>`;
    els.recipientSelect.value = "manual";
    els.manualRecipientBox.style.display = "grid";
    return;
  }

  els.recipientSelect.innerHTML = matches.map((r, index) => `
    <option value="${escapeHtml(r.id)}" ${index === 0 ? "selected" : ""}>
      ${escapeHtml(formatRecipientOption(r))}
    </option>
  `).join("") + `<option value="manual">+ Neuer Empfänger</option>`;

  els.manualRecipientBox.style.display = "none";
}

function onRecipientSelectChange() {
  els.manualRecipientBox.style.display =
    els.recipientSelect.value === "manual" ? "grid" : "none";
}

async function onSubmit(event) {
  event.preventDefault();
  clearNotices();

  const postalCodeRaw = els.postalCode.value.trim();
  const postalCode = normalizePostalCode(postalCodeRaw);
  const slots = Number(els.slots.value);
  const pallets = Number(els.pallets.value);
  const bookingWindow = els.bookingWindow.value.trim();
  const pickupDate = els.pickupDate.value;
  const deliveryDate = els.deliveryDate.value;
  const freeTextNote = els.freeTextNote.value.trim();

  if (!postalCode) return showFatal("Bitte eine PLZ eingeben.");
  if (!els.recipientSelect.value) return showFatal("Bitte Entladestelle auswählen.");
  if (!Number.isFinite(slots) || slots <= 0) return showFatal("Bitte gültige Stellplätze eingeben.");
  if (!Number.isFinite(pallets) || pallets <= 0) return showFatal("Bitte gültige Paletten eingeben.");

  els.resultsSection.style.display = "block";
  els.resultsBody.innerHTML = `<tr><td colspan="7" class="muted">Berechnung läuft...</td></tr>`;

  let data;

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postalCode,
        slots,
        pallets,
        bookingWindow,
        pickupDate,
        deliveryDate,
        freeTextNote,
        selectedRecipientId: els.recipientSelect.value,
        manualRecipient: getManualRecipient()
      })
    });

    data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Berechnung fehlgeschlagen.");
  } catch (error) {
    els.summaryBox.style.display = "none";
    els.resultsSection.style.display = "none";
    return showFatal(`Backend konnte nicht erreicht werden: ${error.message}`);
  }

  if (!data.results || !data.results.length) {
    els.summaryBox.style.display = "none";
    els.resultsSection.style.display = "none";
    return showFatal(data.reason || `Für die PLZ ${postalCodeRaw} wurde kein passender Tarif gefunden.`);
  }

  state.resultsByForwarder = {};
  data.results.forEach(row => {
    state.resultsByForwarder[row.forwarder] = row;
  });

  const recipient = getSelectedRecipient();

  renderSummary({
    postalCode: postalCodeRaw,
    recipient,
    slots,
    pallets,
    bookingWindow,
    pickupDate,
    deliveryDate,
    freeTextNote,
    resultCount: data.results.length,
    missingCount: data.missingCount || 0,
    best: data.results[0]
  });

  renderResults(data.results);
  showSuccess(`Berechnung erfolgreich. ${data.results.length} Dienstleister gefunden.`);
}

function renderSummary({ postalCode, recipient, slots, pallets, bookingWindow, pickupDate, deliveryDate, freeTextNote, resultCount, missingCount, best }) {
  els.summaryPostal.textContent = postalCode || "—";
  els.summaryCountry.textContent = recipient?.land || "—";
  els.summarySlots.textContent = new Intl.NumberFormat("de-DE").format(slots);
  els.summaryPallets.textContent = new Intl.NumberFormat("de-DE").format(pallets);
  els.summaryPickupDate.textContent = formatDisplayDate(pickupDate);
  els.summaryDeliveryDate.textContent = formatDisplayDate(deliveryDate);
  els.summaryBookingWindow.textContent = bookingWindow || "—";
  els.summaryFreeTextNote.textContent = freeTextNote || "—";
  els.summaryRecipient.textContent = recipient ? formatRecipientOption(recipient) : "—";
  els.summaryCount.textContent = `${resultCount}${missingCount ? ` (${missingCount} ohne Ergebnis)` : ""}`;
  els.summaryBest.textContent = `${best.forwarder} (${formatMoney(best.totalPrice)})`;
  els.summaryBox.style.display = "grid";
}

function renderResults(results) {
  els.resultsSection.style.display = "block";
  els.resultsBody.innerHTML = "";

  results.forEach((row, index) => {
    const tr = document.createElement("tr");
    if (index === 0) tr.className = "best-row";

    const hasEmail = Boolean(row.email);

    tr.innerHTML = `
      <td>
        ${index === 0 ? `<span class="badge">Günstigster</span>` : ""}
        <span class="provider-name">${escapeHtml(row.forwarder)}</span>
      </td>
      <td class="right">${formatMoney(row.basePrice)}</td>
      <td class="right">${formatPercent(row.floaterRate)}</td>
      <td class="right">${formatMoney(row.floaterEuro)}</td>
      <td class="right total-price">${formatMoney(row.totalPrice)}</td>
      <td>
        <button type="button" class="action-btn" ${hasEmail ? "" : "disabled"}
          onclick="createEmailRequest('${escapeJs(row.forwarder)}', 'availability')">
          Verfügbarkeit anfragen
        </button>
      </td>
      <td>
        <button type="button" class="action-btn secondary-action" ${hasEmail ? "" : "disabled"}
          onclick="createEmailRequest('${escapeJs(row.forwarder)}', 'booking')">
          Sendung buchen
        </button>
      </td>
    `;

    els.resultsBody.appendChild(tr);
  });
}

function createEmailRequest(forwarder, type) {
  const result = state.resultsByForwarder[forwarder] || {};
  const to = result.email || "";

  if (!to) return alert(`Für ${forwarder} ist noch keine E-Mail-Adresse hinterlegt.`);

  const recipient = getSelectedRecipient();
  const plz = els.postalCode.value.trim();
  const slots = els.slots.value.trim();
  const pallets = els.pallets.value.trim();
  const bookingWindow = els.bookingWindow.value.trim();
  const pickupDate = formatDisplayDate(els.pickupDate.value);
  const deliveryDate = formatDisplayDate(els.deliveryDate.value);
  const freeTextNote = els.freeTextNote.value.trim();

  const subject = type === "booking"
    ? `Sendungsbuchung ${plz} / ${forwarder}`
    : `Verfügbarkeitsanfrage ${plz} / ${forwarder}`;

  const recipientText = recipient
    ? `${recipient.name1 || ""}${recipient.name2 ? ` ${recipient.name2}` : ""}\n${recipient.strasse || ""}\n${recipient.plz || plz} ${recipient.stadt || ""}\n${recipient.land || ""}`.trim()
    : `PLZ ${plz}`;

  const bodyText = type === "booking"
    ? `Guten Tag zusammen,

hiermit buchen wir die folgende Sendung:

Entladestelle:
${recipientText}

Stellplätze: ${slots}
Paletten: ${pallets}
Abholdatum: ${pickupDate}
Liefertermin: ${deliveryDate}
Zeitfenster: ${bookingWindow || "-"}
Preis laut Kalkulation: ${formatMoney(result.totalPrice)}

Hinweis:
${freeTextNote || "-"}

Bitte bestätigen Sie uns die Buchung kurz schriftlich.

Vielen Dank.`
    : `Guten Tag zusammen,

bitte prüfen Sie die Verfügbarkeit für folgende Sendung:

Entladestelle:
${recipientText}

Stellplätze: ${slots}
Paletten: ${pallets}
Abholdatum: ${pickupDate}
Liefertermin: ${deliveryDate}
Zeitfenster: ${bookingWindow || "-"}

Hinweis:
${freeTextNote || "-"}

Bitte senden Sie uns kurzfristig eine Rückmeldung zur Verfügbarkeit.

Vielen Dank.`;

  window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
}

function getSelectedRecipient() {
  if (els.recipientSelect.value === "manual") {
    const manual = getManualRecipient();
    if (!manual.name1 && !manual.strasse && !manual.stadt && !manual.land) return null;
    return manual;
  }

  return state.recipientsById[els.recipientSelect.value] || null;
}

function getManualRecipient() {
  return {
    id: "manual",
    name1: els.recipientName.value.trim(),
    name2: "",
    strasse: els.recipientStreet.value.trim(),
    plz: normalizePostalCode(els.postalCode.value),
    stadt: els.recipientCity.value.trim(),
    land: els.recipientCountry.value.trim().toUpperCase()
  };
}

function calculatePalletsFromSlots(slots) {
  return Number.isFinite(slots) && slots > 0 ? Math.ceil(slots) : NaN;
}

function formatRecipientOption(r) {
  return `${r.name1 || "Ohne Name"}${r.name2 ? ` ${r.name2}` : ""} – ${r.strasse || "ohne Straße"} – ${r.plz || ""} ${r.stadt || ""} ${r.land ? `(${r.land})` : ""}`.trim();
}

function normalizePostalCode(value) {
  return String(value || "").toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9]/g, "");
}

function formatMoney(value) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value || 0);
}

function formatPercent(value) {
  return new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((value || 0) * 100) + " %";
}

function formatDisplayDate(value) {
  if (!value) return "—";
  const [year, month, day] = String(value).split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}

function showFatal(text) {
  els.fatalError.textContent = text;
  els.fatalError.style.display = "block";
}

function showSuccess(text) {
  els.successNotice.textContent = text;
  els.successNotice.style.display = "block";
}

function clearNotices() {
  els.fatalError.style.display = "none";
  els.fatalError.textContent = "";
  els.successNotice.style.display = "none";
  els.successNotice.textContent = "";
}

function onReset() {
  setTimeout(() => {
    clearNotices();
    state.resultsByForwarder = {};
    state.recipientsById = {};
    els.summaryBox.style.display = "none";
    els.resultsSection.style.display = "none";
    els.resultsBody.innerHTML = `<tr><td colspan="7" class="muted">Noch keine Berechnung.</td></tr>`;
    els.recipientSelect.innerHTML = `<option value="">Bitte PLZ eingeben</option>`;
    els.manualRecipientBox.style.display = "none";
    syncDerivedFieldsFromSlots();
  }, 0);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeJs(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}