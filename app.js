const API_URL = "https://project-h2k76.vercel.app/api/calculate";

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
  els.recipientSelect.addEventListener("change", onRecipientSelectChange);

  syncDerivedFieldsFromSlots();
  state.initialized = true;

  els.form.addEventListener("submit", onSubmit);
  els.form.addEventListener("reset", onReset);
});

function syncDerivedFieldsFromSlots() {
  const slots = Number(els.slots.value);
  const pallets = calculatePalletsFromSlots(slots);

  if (!els.pallets.matches(":focus")) {
    els.pallets.value = Number.isFinite(pallets) ? String(pallets) : "";
  }
}

async function onSubmit(event) {
  event.preventDefault();
  if (!state.initialized) return;

  clearNotices();

  const postalCodeRaw = els.postalCode.value.trim();
  const postalCode = normalizePostalCode(postalCodeRaw);
  const slots = Number(els.slots.value);
  const pallets = Number(els.pallets.value);
  const bookingWindow = els.bookingWindow.value.trim();
  const pickupDate = els.pickupDate.value;
  const deliveryDate = els.deliveryDate.value;
  const freeTextNote = els.freeTextNote.value.trim();

  if (!postalCode) {
    showFatal("Bitte eine PLZ eingeben.");
    return;
  }

  if (!Number.isFinite(slots) || slots <= 0) {
    showFatal("Bitte gültige Stellplätze eingeben.");
    return;
  }

  if (!Number.isFinite(pallets) || pallets <= 0) {
    showFatal("Bitte gültige Paletten eingeben.");
    return;
  }

  els.resultsSection.style.display = "block";
  els.resultsBody.innerHTML = `<tr><td colspan="7" class="muted">Berechnung läuft...</td></tr>`;

  let data;

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
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

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Berechnung fehlgeschlagen.");
    }
  } catch (error) {
    showFatal(`Backend konnte nicht erreicht werden: ${error.message}`);
    els.summaryBox.style.display = "none";
    els.resultsSection.style.display = "none";
    return;
  }

  renderRecipientSelection(data.empfaengerMatches || []);

  if (!data.results || !data.results.length) {
    showFatal(data.reason || `Für die PLZ ${postalCodeRaw} wurde kein passender Tarif gefunden.`);
    els.summaryBox.style.display = "none";
    els.resultsSection.style.display = "none";
    return;
  }

  state.resultsByForwarder = {};
  data.results.forEach((row) => {
    state.resultsByForwarder[row.forwarder] = row;
  });

  const recipient = getSelectedRecipient();

  renderSummary({
    postalCode: postalCodeRaw,
    country: recipient?.land || "",
    slots,
    pallets,
    bookingWindow,
    pickupDate,
    deliveryDate,
    freeTextNote,
    recipient,
    resultCount: data.results.length,
    missingCount: data.missingCount || 0,
    best: data.results[0]
  });

  renderResults(data.results);
  showSuccess(`Berechnung erfolgreich. ${data.results.length} Dienstleister gefunden${data.missingCount ? `, ${data.missingCount} ohne Ergebnis` : ""}.`);
}

function renderRecipientSelection(matches) {
  state.lastRecipientMatches = matches;
  state.recipientsById = {};
  els.recipientSelect.innerHTML = "";

  matches.forEach((recipient) => {
    state.recipientsById[String(recipient.id)] = recipient;
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
      <option value="${escapeHtml(r.id)}" selected>${escapeHtml(formatRecipientOption(r))}</option>
      <option value="manual">+ Neuer Empfänger</option>
    `;
    els.manualRecipientBox.style.display = "none";
    return;
  }

  const previousValue = els.recipientSelect.value;

  els.recipientSelect.innerHTML = `
    <option value="">Bitte Entladestelle auswählen</option>
    ${matches.map(r => `
      <option value="${escapeHtml(r.id)}">${escapeHtml(formatRecipientOption(r))}</option>
    `).join("")}
    <option value="manual">+ Neuer Empfänger</option>
  `;

  if (previousValue && state.recipientsById[previousValue]) {
    els.recipientSelect.value = previousValue;
  }

  els.manualRecipientBox.style.display =
    els.recipientSelect.value === "manual" ? "grid" : "none";
}

function onRecipientSelectChange() {
  els.manualRecipientBox.style.display =
    els.recipientSelect.value === "manual" ? "grid" : "none";
}

function renderSummary({
  postalCode,
  country,
  slots,
  pallets,
  bookingWindow,
  pickupDate,
  deliveryDate,
  freeTextNote,
  recipient,
  resultCount,
  missingCount,
  best
}) {
  els.summaryPostal.textContent = postalCode || "—";
  els.summaryCountry.textContent = country || recipient?.land || "—";
  els.summarySlots.textContent = new Intl.NumberFormat("de-DE").format(slots);
  els.summaryPallets.textContent = new Intl.NumberFormat("de-DE").format(pallets);
  els.summaryBookingWindow.textContent = bookingWindow || "—";
  els.summaryPickupDate.textContent = formatDisplayDate(pickupDate);
  els.summaryDeliveryDate.textContent = formatDisplayDate(deliveryDate);
  els.summaryFreeTextNote.textContent = freeTextNote || "—";
  els.summaryRecipient.textContent = recipient ? formatRecipientOption(recipient) : "—";
  els.summaryCount.textContent = `${new Intl.NumberFormat("de-DE").format(resultCount)}${missingCount ? ` (${missingCount} ohne Ergebnis)` : ""}`;
  els.summaryBest.textContent = `${best.forwarder} (${formatMoney(best.totalPrice)})`;
  els.summaryBox.style.display = "grid";
}

function renderResults(results) {
  els.resultsSection.style.display = "block";
  els.resultsBody.innerHTML = "";

  results.forEach((row, index) => {
    const tr = document.createElement("tr");
    if (index === 0) tr.className = "best-row";

    const providerCell = index === 0
      ? `<span class="badge">Günstigster</span><span class="provider-name">${escapeHtml(row.forwarder)}</span>`
      : `<span class="provider-name">${escapeHtml(row.forwarder)}</span>`;

    const hasEmail = Boolean(row.email);
    const availabilityButton = `<button type="button" class="action-btn" ${hasEmail ? "" : "disabled"} onclick="createEmailRequest('${escapeJs(row.forwarder)}', 'availability')">Verfügbarkeit anfragen</button>`;
    const bookingButton = `<button type="button" class="action-btn secondary-action" ${hasEmail ? "" : "disabled"} onclick="createEmailRequest('${escapeJs(row.forwarder)}', 'booking')">Sendung buchen</button>`;

    tr.innerHTML = `
      <td>${providerCell}</td>
      <td class="right">${formatMoney(row.basePrice)}</td>
      <td class="right">${formatPercent(row.floaterRate)}</td>
      <td class="right">${formatMoney(row.floaterEuro)}</td>
      <td class="right total-price">${formatMoney(row.totalPrice)}</td>
      <td>${availabilityButton}</td>
      <td>${bookingButton}</td>
    `;

    els.resultsBody.appendChild(tr);
  });
}

function createEmailRequest(forwarder, type) {
  const result = state.resultsByForwarder[forwarder] || {};
  const to = result.email || "";

  if (!to) {
    alert(`Für ${forwarder} ist noch keine E-Mail-Adresse hinterlegt.`);
    return;
  }

  const recipient = getSelectedRecipient();
  const plz = els.postalCode.value.trim();
  const slots = els.slots.value.trim();
  const pallets = els.pallets.value.trim();
  const bookingWindow = els.bookingWindow.value.trim();
  const pickupDate = formatDisplayDate(els.pickupDate.value);
  const deliveryDate = formatDisplayDate(els.deliveryDate.value);
  const freeTextNote = els.freeTextNote.value.trim();

  const subject =
    type === "booking"
      ? `Sendungsbuchung ${plz} / ${forwarder}`
      : `Verfügbarkeitsanfrage ${plz} / ${forwarder}`;

  const recipientText = recipient
    ? `${recipient.name1 || ""}${recipient.name2 ? ` ${recipient.name2}` : ""}\n${recipient.strasse || ""}\n${recipient.plz || plz} ${recipient.stadt || ""}\n${recipient.land || ""}`.trim()
    : `PLZ ${plz}`;

  let bodyText = "";

  if (type === "booking") {
    bodyText =
`Guten Tag zusammen,

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

Vielen Dank.`;
  } else {
    bodyText =
`Guten Tag zusammen,

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
  }

  window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
}

function getSelectedRecipient() {
  const selected = els.recipientSelect.value;

  if (selected === "manual") {
    const manual = getManualRecipient();
    if (!manual.name1 && !manual.strasse && !manual.stadt && !manual.land) return null;
    return manual;
  }

  return state.recipientsById[selected] || null;
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
  if (!Number.isFinite(slots) || slots <= 0) return NaN;
  return Math.ceil(slots);
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
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format((value || 0) * 100) + " %";
}

function formatDisplayDate(value) {
  if (!value) return "—";
  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) return value || "—";
  return `${day}.${month}.${year}`;
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
    state.lastRecipientMatches = {};
    els.summaryBox.style.display = "none";
    els.resultsSection.style.display = "none";
    els.resultsBody.innerHTML = `<tr><td colspan="7" class="muted">Noch keine Berechnung.</td></tr>`;
    els.recipientSelect.innerHTML = `<option value="">Bitte zuerst berechnen</option>`;
    els.manualRecipientBox.style.display = "none";
    els.slots.value = "1";
    els.pallets.value = "1";
    els.bookingWindow.value = "";
    els.pickupDate.value = "";
    els.deliveryDate.value = "";
    els.freeTextNote.value = "";
    els.recipientName.value = "";
    els.recipientStreet.value = "";
    els.recipientCity.value = "";
    els.recipientCountry.value = "";
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
