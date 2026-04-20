const state = {
  rates: [],
  zones: [],
  floater: {},
  ancillary: {},
  initialized: false
};

const els = {
  form: document.getElementById("calculatorForm"),
  postalCode: document.getElementById("postalCode"),
  pallets: document.getElementById("pallets"),
  messageBox: document.getElementById("messageBox"),
  fatalError: document.getElementById("fatalError"),
  summaryBox: document.getElementById("summaryBox"),
  summaryPostal: document.getElementById("summaryPostal"),
  summaryPallets: document.getElementById("summaryPallets"),
  summaryTransport: document.getElementById("summaryTransport"),
  summaryCount: document.getElementById("summaryCount"),
  summaryBest: document.getElementById("summaryBest"),
  resultsSection: document.getElementById("resultsSection"),
  resultsBody: document.getElementById("resultsBody"),
  transportOptions: Array.from(document.querySelectorAll(".transport-option")),
  transportInputs: Array.from(document.querySelectorAll('input[name="transportType"]'))
};

document.addEventListener("DOMContentLoaded", () => {
  setupTransportToggle();
  loadAllData().then(() => {
    state.initialized = true;
  }).catch((error) => {
    showFatal(`Dateien konnten nicht geladen werden: ${error.message}`);
  });

  els.form.addEventListener("submit", onSubmit);
  els.form.addEventListener("reset", onReset);
});

function setupTransportToggle() {
  els.transportInputs.forEach((input) => {
    input.addEventListener("change", () => {
      els.transportOptions.forEach((option) => {
        option.classList.toggle("active", option.querySelector("input").checked);
      });

      const selected = getTransportType();
      if (selected === "FTL") {
        els.pallets.value = "34";
        els.pallets.readOnly = true;
      } else {
        els.pallets.readOnly = false;
        if (!els.pallets.value || Number(els.pallets.value) === 34) {
          els.pallets.value = "1";
        }
      }
    });
  });
}

async function loadAllData() {
  const [ratesText, zonesText, floater, ancillary] = await Promise.all([
    fetchText("rates.csv"),
    fetchText("zones.csv"),
    fetchJson("floater.json", {}),
    fetchJson("ancillary.json", {})
  ]);

  state.rates = parseRatesCsv(ratesText);
  state.zones = parseZonesCsv(zonesText);
  state.floater = normalizeFloater(floater);
  state.ancillary = normalizeAncillary(ancillary);
}

async function fetchText(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} (${response.status})`);
  return await response.text();
}

async function fetchJson(path, fallback) {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) return fallback;
    return await response.json();
  } catch {
    return fallback;
  }
}

function parseSemicolonCsv(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter(line => line.trim() !== "");
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = splitCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = (values[index] ?? "").trim();
    });
    return row;
  });
}

function splitCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ';' && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

function parseRatesCsv(text) {
  return parseSemicolonCsv(text).map((row) => {
    const zonePrices = {};
    Object.keys(row).forEach((key) => {
      const match = key.match(/^Zone\s+(\d+)$/i);
      if (match) zonePrices[match[1]] = parseGermanNumber(row[key]);
    });

    return {
      forwarder: (row["Forwarder"] || "").trim(),
      originCountry: (row["Origin CTRY"] || "").trim(),
      destCountry: (row["Dest CTRY"] || "").trim(),
      chgFrom: parseGermanNumber(row["CHG from"]),
      chgTo: parseGermanNumber(row["CHG to"]),
      unit: ((row["Unit"] || "").trim().toUpperCase()),
      zonePrices
    };
  }).filter(row => row.forwarder);
}

function parseZonesCsv(text) {
  return parseSemicolonCsv(text).map((row) => ({
    forwarder: (row["Forwarder"] || "").trim(),
    originCountry: (row["Origin CTRY"] || "").trim(),
    destCountry: (row["Dest CTRY"] || "").trim(),
    destFromRaw: (row["Dest From"] || "").trim(),
    destToRaw: (row["Dest To"] || "").trim(),
    zone: String(row["Zone"] || "").trim()
  })).filter(row => row.zone);
}

function normalizeFloater(input) {
  const result = {};
  Object.entries(input || {}).forEach(([key, value]) => {
    result[normalizeName(key)] = parseGermanNumber(value);
  });
  return result;
}

function normalizeAncillary(input) {
  const result = {};
  Object.entries(input || {}).forEach(([key, value]) => {
    const normalizedKey = normalizeName(key);
    result[normalizedKey] = {
      enabled: Boolean(value?.enabled ?? true),
      mode: String(value?.mode || "per_psp"),
      value: parseGermanNumber(value?.value ?? 0)
    };
  });
  return result;
}

function parseGermanNumber(value) {
  if (typeof value === "number") return value;
  const normalized = String(value ?? "")
    .trim()
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePostalCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "");
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

function getTransportType() {
  return els.transportInputs.find(input => input.checked)?.value || "Teilladung";
}

function showMessage(type, text) {
  els.messageBox.className = `notice ${type}`;
  els.messageBox.textContent = text;
  els.messageBox.style.display = "block";
}

function hideMessage() {
  els.messageBox.style.display = "none";
  els.messageBox.textContent = "";
  els.messageBox.className = "notice";
}

function showFatal(text) {
  els.fatalError.textContent = text;
  els.fatalError.style.display = "block";
}

function clearFatal() {
  els.fatalError.style.display = "none";
  els.fatalError.textContent = "";
}

function onReset() {
  setTimeout(() => {
    hideMessage();
    clearFatal();
    els.summaryBox.style.display = "none";
    els.resultsSection.style.display = "none";
    els.resultsBody.innerHTML = `<tr><td colspan="9" class="muted">Noch keine Berechnung.</td></tr>`;
    els.transportInputs.forEach(input => {
      input.checked = input.value === "Teilladung";
    });
    els.transportOptions.forEach(option => {
      option.classList.toggle("active", option.querySelector("input").checked);
    });
    els.pallets.readOnly = false;
    els.pallets.value = "1";
  }, 0);
}

async function onSubmit(event) {
  event.preventDefault();

  if (!state.initialized) {
    showMessage("danger", "Die Daten werden noch geladen. Bitte kurz erneut versuchen.");
    return;
  }

  hideMessage();
  clearFatal();

  const postalCodeRaw = els.postalCode.value.trim();
  const postalCode = normalizePostalCode(postalCodeRaw);
  const pallets = Number(els.pallets.value);
  const transportType = getTransportType();

  if (!postalCode) {
    showMessage("danger", "Bitte eine PLZ eingeben.");
    return;
  }
  if (!Number.isFinite(pallets) || pallets <= 0) {
    showMessage("danger", "Bitte eine gültige Palettenanzahl eingeben.");
    return;
  }

  const calculations = calculateAll(postalCode, pallets);
  if (!calculations.results.length) {
    const zoneExistsAnywhere = state.zones.some(z => zoneMatchesPostal(z, postalCode));
    const reason = zoneExistsAnywhere
      ? `Für die PLZ ${postalCodeRaw} wurde kein passender Tarif gefunden.`
      : `Keine Zone gefunden. Für die PLZ ${postalCodeRaw} liegt aktuell keine Zuordnung vor.`;
    showMessage("danger", reason);
    els.summaryBox.style.display = "none";
    els.resultsSection.style.display = "none";
    return;
  }

  renderSummary({
    postalCode: postalCodeRaw,
    pallets,
    transportType,
    resultCount: calculations.results.length,
    best: calculations.results[0]
  });

  renderResults(calculations.results);
  showMessage(
    "success",
    `Berechnung erfolgreich. ${calculations.results.length} Dienstleister gefunden, ${calculations.missingCount} ohne Ergebnis.`
  );
}

function calculateAll(postalCode, pallets) {
  const allForwarders = [...new Set(state.rates.map(row => row.forwarder))];
  const results = [];
  let missingCount = 0;

  allForwarders.forEach((forwarder) => {
    const zoneInfo = findZoneForForwarder(forwarder, postalCode);
    if (!zoneInfo) {
      missingCount++;
      return;
    }

    const matchingRates = state.rates.filter((row) =>
      normalizeName(row.forwarder) === normalizeName(forwarder) &&
      pallets >= row.chgFrom &&
      pallets <= row.chgTo
    );

    if (!matchingRates.length) {
      missingCount++;
      return;
    }

    const zonePriceColumn = zoneInfo.zone;
    const viable = [];

    matchingRates.forEach((rate) => {
      const rawZonePrice = rate.zonePrices[zonePriceColumn];
      if (!Number.isFinite(rawZonePrice) || rawZonePrice >= 90000) return;

      let basePrice = rawZonePrice;
      let pricingReason = rate.unit || "Tarif";

      if (rate.unit === "PLL") {
        basePrice = rawZonePrice * pallets;
        pricingReason = "PLL × Paletten";
      } else if (rate.unit === "SHP") {
        basePrice = rawZonePrice;
        pricingReason = "SHP";
      }

      const floaterRate = state.floater[normalizeName(forwarder)] || 0;
      const floaterEuro = basePrice * floaterRate;
      const ancillaryCharge = calculateAncillary(forwarder, pallets);
      const totalPrice = basePrice + floaterEuro + ancillaryCharge;

      viable.push({
        forwarder,
        zone: zoneInfo.zone,
        tariffBand: `${formatBand(rate.chgFrom)} – ${formatBand(rate.chgTo)} ${rate.unit || ""}`.trim(),
        basePrice,
        floaterRate,
        floaterEuro,
        ancillaryCharge,
        totalPrice,
        reason: pricingReason
      });
    });

    if (!viable.length) {
      missingCount++;
      return;
    }

    viable.sort((a, b) => a.totalPrice - b.totalPrice);
    results.push(viable[0]);
  });

  results.sort((a, b) => a.totalPrice - b.totalPrice);
  return { results, missingCount };
}

function calculateAncillary(forwarder, pallets) {
  const entry = state.ancillary[normalizeName(forwarder)];
  if (!entry || entry.enabled === false) return 0;

  if (entry.mode === "fixed") return entry.value;
  if (entry.mode === "per_psp" || entry.mode === "per_palette") return entry.value * pallets;
  return 0;
}

function formatBand(value) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
}

function findZoneForForwarder(forwarder, postalCode) {
  const specific = state.zones.find((row) =>
    normalizeName(row.forwarder) === normalizeName(forwarder) &&
    zoneMatchesPostal(row, postalCode)
  );
  if (specific) return specific;

  return state.zones.find((row) =>
    normalizeName(row.forwarder) === "all" &&
    zoneMatchesPostal(row, postalCode)
  ) || null;
}

function zoneMatchesPostal(zoneRow, postalCode) {
  const input = normalizePostalCode(postalCode);
  const from = normalizePostalCode(zoneRow.destFromRaw);
  const to = normalizePostalCode(zoneRow.destToRaw);

  if (!input || !from || !to) return false;

  const inputNum = Number(input);
  const fromNum = Number(from);
  const toNum = Number(to);

  if ([inputNum, fromNum, toNum].every(Number.isFinite)) {
    return inputNum >= fromNum && inputNum <= toNum;
  }

  return input >= from && input <= to;
}

function renderSummary({ postalCode, pallets, transportType, resultCount, best }) {
  els.summaryPostal.textContent = postalCode;
  els.summaryPallets.textContent = new Intl.NumberFormat("de-DE").format(pallets);
  els.summaryTransport.textContent = transportType;
  els.summaryCount.textContent = new Intl.NumberFormat("de-DE").format(resultCount);
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

    tr.innerHTML = `
      <td>${providerCell}</td>
      <td>${escapeHtml(row.zone)}</td>
      <td>${escapeHtml(row.tariffBand)}</td>
      <td class="right">${formatMoney(row.basePrice)}</td>
      <td class="right">${formatPercent(row.floaterRate)}</td>
      <td class="right">${formatMoney(row.floaterEuro)}</td>
      <td class="right">${formatMoney(row.ancillaryCharge)}</td>
      <td class="right total-price">${formatMoney(row.totalPrice)}</td>
      <td>${escapeHtml(row.reason)}</td>
    `;
    els.resultsBody.appendChild(tr);
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
