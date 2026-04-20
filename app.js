const ORIGIN_COUNTRY = 'DE';
const DEFAULT_ZONE_MODE = 'ALL';
const PRICE_SENTINEL = 99999;

const STATE = {
  zones: [],
  rates: [],
  floaterConfig: {},
  ancillaryConfig: {},
  forwarders: [],
  countries: [],
};

const ZONE_MODE_BY_FORWARDER = {
  morrisson: 'Morrisson',
};

const POSTAL_PLACEHOLDERS = {
  DE: 'z. B. 24939',
  AT: 'z. B. 1010',
  BE: 'z. B. 1000',
  CH: 'z. B. 8001',
  DK: 'z. B. 8000',
  FR: 'z. B. 75008',
  GB: 'z. B. SW1A 1AA',
  IT: 'z. B. 20121',
  NL: 'z. B. 1012 AB',
  SE: 'z. B. 114 55',
  SK: 'z. B. 811 01',
};

function normalizeHeader(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').replace(/\u0000/g, '').trim().toLowerCase();
}

function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizePostalByCountry(country, value) {
  const normalizedCountry = String(country ?? '').trim().toUpperCase();
  const base = String(value ?? '').trim().toUpperCase();
  if (!base) return '';
  if (['GB', 'SE', 'SK'].includes(normalizedCountry)) return base.replace(/[^A-Z0-9]/g, '');
  return base.replace(/\s+/g, '');
}

function getGbZoneKey(postalCode) {
  const postal = normalizePostalByCountry('GB', postalCode);
  const outwardMatch = postal.match(/^[A-Z]{1,2}\d[A-Z\d]?/);
  const outward = outwardMatch ? outwardMatch[0] : postal;
  return outward.slice(0, 2);
}

function parseNumberFlexible(value) {
  if (value == null) return NaN;
  const raw = String(value).replace(/[€%]/g, '').trim();
  if (!raw) return NaN;
  const cleaned = raw.replace(/\s+/g, '');
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');
  if (hasComma && hasDot) return Number(cleaned.replace(/\./g, '').replace(/,/g, '.'));
  if (hasComma) return Number(cleaned.replace(/,/g, '.'));
  if (hasDot) {
    const parts = cleaned.split('.');
    if (parts.length === 2 && parts[1].length <= 2) return Number(cleaned);
    return Number(cleaned.replace(/\./g, ''));
  }
  return Number(cleaned);
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function money(value) { return Number.isFinite(value) ? `${formatNumber(value, 2)} €` : '—'; }
function percent(value) { return Number.isFinite(value) ? `${formatNumber(value, 2)} %` : '0,00 %'; }

async function fetchTextSmart(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url} konnte nicht geladen werden (HTTP ${response.status})`);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let encoding = 'utf-8';
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  return new TextDecoder(encoding).decode(buffer);
}

function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 5).join('\n');
  const counts = {
    ';': (sample.match(/;/g) || []).length,
    '\t': (sample.match(/\t/g) || []).length,
    ',': (sample.match(/,/g) || []).length,
  };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || ';';
}

function parseCsv(text) {
  const delimiter = detectDelimiter(text);
  const rows = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  for (const line of lines) {
    const cells = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') { current += '"'; i += 1; }
        else quoted = !quoted;
      } else if (char === delimiter && !quoted) {
        cells.push(current.trim());
        current = '';
      } else current += char;
    }
    cells.push(current.trim());
    rows.push(cells);
  }
  return rows;
}

function detectZoneColumns(headersRaw) {
  const columns = [];
  headersRaw.forEach((header, index) => {
    const match = String(header).trim().match(/^zone\s*(\d+)$/i);
    if (match) columns.push({ index, zone: Number(match[1]) });
  });
  return columns;
}

function getColumnIndex(headers, variants) {
  for (const variant of variants) {
    const index = headers.indexOf(normalizeHeader(variant));
    if (index >= 0) return index;
  }
  return -1;
}

function isNumericZoneValue(value) { return /^\d+$/.test(String(value ?? '').trim()); }
function isPlaceholderPrice(value) { return Number.isFinite(value) && value >= PRICE_SENTINEL; }
function getZoneMode(forwarder) { return ZONE_MODE_BY_FORWARDER[normalizeKey(forwarder)] || DEFAULT_ZONE_MODE; }

function getFloaterPercent(forwarder) {
  const key = normalizeKey(forwarder);
  const value = STATE.floaterConfig[key];
  return Number.isFinite(value) ? value : 0;
}

function getAncillaryConfig(forwarder) {
  const key = normalizeKey(forwarder);
  return STATE.ancillaryConfig[key] || null;
}

async function loadZones() {
  const rows = parseCsv(await fetchTextSmart('zones.csv'));
  const headerRowIndex = rows.findIndex((row) => row.map(normalizeHeader).includes('forwarder'));
  if (headerRowIndex < 0) throw new Error('zones.csv: Header konnte nicht gelesen werden.');

  const headers = rows[headerRowIndex].map(normalizeHeader);
  const iForwarder = getColumnIndex(headers, ['forwarder']);
  const iOrigin = getColumnIndex(headers, ['origin ctry', 'origin country']);
  const iDest = getColumnIndex(headers, ['dest ctry', 'dest country']);
  const iFrom = getColumnIndex(headers, ['dest from', 'postal from', 'from']);
  const iTo = getColumnIndex(headers, ['dest to', 'postal to', 'to']);
  const iZone = getColumnIndex(headers, ['zone']);

  if ([iForwarder, iFrom, iTo, iZone].some((i) => i < 0)) {
    throw new Error('zones.csv: Pflichtspalten fehlen.');
  }

  STATE.zones = rows.slice(headerRowIndex + 1)
    .filter((row) => row[iForwarder])
    .map((row) => {
      const destCountry = String(iDest >= 0 ? row[iDest] : '' || 'DE').trim() || 'DE';
      const fromRaw = String(row[iFrom] ?? '').trim();
      const toRaw = String(row[iTo] ?? '').trim();
      return {
        forwarder: String(row[iForwarder] ?? '').trim(),
        originCountry: String(iOrigin >= 0 ? row[iOrigin] : ORIGIN_COUNTRY).trim() || ORIGIN_COUNTRY,
        destCountry,
        fromNorm: normalizePostalByCountry(destCountry, fromRaw),
        toNorm: normalizePostalByCountry(destCountry, toRaw),
        numericFrom: isNumericZoneValue(fromRaw) ? Number.parseInt(fromRaw, 10) : null,
        numericTo: isNumericZoneValue(toRaw) ? Number.parseInt(toRaw, 10) : null,
        zone: Number.parseInt(String(row[iZone]).trim(), 10),
      };
    })
    .filter((row) => Number.isFinite(row.zone));
}

async function loadRates() {
  const rows = parseCsv(await fetchTextSmart('rates.csv'));
  const headersRaw = rows[0];
  const headers = headersRaw.map(normalizeHeader);
  const iForwarder = getColumnIndex(headers, ['forwarder']);
  const iOrigin = getColumnIndex(headers, ['origin ctry', 'origin country']);
  const iDest = getColumnIndex(headers, ['dest ctry', 'dest country']);
  const iFrom = getColumnIndex(headers, ['chg from', 'from']);
  const iTo = getColumnIndex(headers, ['chg to', 'to']);
  const iUnit = getColumnIndex(headers, ['unit']);
  const zoneCols = detectZoneColumns(headersRaw);

  if ([iForwarder, iFrom, iTo, iUnit].some((i) => i < 0) || zoneCols.length === 0) {
    throw new Error('rates.csv: Header konnte nicht gelesen werden.');
  }

  STATE.rates = rows.slice(1)
    .filter((row) => row[iForwarder])
    .map((row) => {
      const zonePrices = new Map();
      zoneCols.forEach(({ index, zone }) => {
        const amount = parseNumberFlexible(row[index]);
        if (Number.isFinite(amount) && !isPlaceholderPrice(amount)) zonePrices.set(zone, amount);
      });

      return {
        forwarder: String(row[iForwarder] ?? '').trim(),
        originCountry: String(iOrigin >= 0 ? row[iOrigin] : ORIGIN_COUNTRY).trim() || ORIGIN_COUNTRY,
        destCountry: String(iDest >= 0 ? row[iDest] : 'DE').trim() || 'DE',
        from: parseNumberFlexible(row[iFrom]),
        to: parseNumberFlexible(row[iTo]),
        unit: String(row[iUnit] ?? '').trim(),
        zonePrices,
      };
    })
    .filter((row) => Number.isFinite(row.from) && Number.isFinite(row.to));

  STATE.forwarders = Array.from(new Set(STATE.rates.map((row) => row.forwarder))).sort((a, b) => a.localeCompare(b, 'de'));
  STATE.countries = Array.from(new Set(STATE.rates.map((row) => row.destCountry).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'de'));
}

async function loadFloaterConfig() {
  const data = JSON.parse(await fetchTextSmart('floater.json'));
  const normalized = {};
  Object.entries(data || {}).forEach(([key, value]) => {
    const num = Number(value);
    normalized[normalizeKey(key)] = Number.isFinite(num) ? num : 0;
  });
  STATE.floaterConfig = normalized;
}

async function loadAncillaryConfig() {
  try {
    const data = JSON.parse(await fetchTextSmart('ancillary.json'));
    const normalized = {};
    Object.entries(data || {}).forEach(([key, value]) => {
      normalized[normalizeKey(key)] = {
        enabled: value?.enabled !== false,
        mode: value?.mode || 'disabled',
        value: parseNumberFlexible(value?.value),
        label: String(value?.label || 'Palettentausch').trim() || 'Palettentausch',
      };
    });
    STATE.ancillaryConfig = normalized;
  } catch (_) {
    STATE.ancillaryConfig = {};
  }
}

function postalMatchesZone(row, postalCode) {
  const country = String(row.destCountry ?? '').toUpperCase().trim();
  const postal = normalizePostalByCountry(country, postalCode);
  if (!postal) return false;

  if (country === 'GB') {
    const gbKey = getGbZoneKey(postal);
    if (!gbKey || !row.fromNorm || !row.toNorm) return false;
    if (row.fromNorm === row.toNorm) return gbKey === row.fromNorm;
    return gbKey >= row.fromNorm && gbKey <= row.toNorm;
  }

  if (row.numericFrom != null && row.numericTo != null && /^\d+$/.test(postal)) {
    const postalNum = Number.parseInt(postal, 10);
    return postalNum >= row.numericFrom && postalNum <= row.numericTo;
  }

  if (!row.fromNorm || !row.toNorm) return false;
  if (row.fromNorm === row.toNorm) return postal.startsWith(row.fromNorm);
  if (row.fromNorm.length === row.toNorm.length && postal.length >= row.fromNorm.length) {
    const prefix = postal.slice(0, row.fromNorm.length);
    return prefix >= row.fromNorm && prefix <= row.toNorm;
  }
  return postal >= row.fromNorm && postal <= row.toNorm;
}

function findZone(forwarder, destCountry, postalCode) {
  const zoneMode = getZoneMode(forwarder);
  const matches = STATE.zones.filter((row) => (
    normalizeKey(row.forwarder) === normalizeKey(zoneMode)
    && normalizeKey(row.originCountry) === normalizeKey(ORIGIN_COUNTRY)
    && normalizeKey(row.destCountry) === normalizeKey(destCountry)
    && postalMatchesZone(row, postalCode)
  ));

  if (!matches.length) return null;
  matches.sort((a, b) => {
    const aLen = a.fromNorm.length;
    const bLen = b.fromNorm.length;
    if (bLen !== aLen) return bLen - aLen;
    const aWidth = (a.numericTo ?? 0) - (a.numericFrom ?? 0);
    const bWidth = (b.numericTo ?? 0) - (b.numericFrom ?? 0);
    return aWidth - bWidth;
  });
  return { zone: matches[0].zone, zoneMode };
}

function getRateRows(forwarder, destCountry, psp) {
  return STATE.rates.filter((row) => (
    normalizeKey(row.forwarder) === normalizeKey(forwarder)
    && normalizeKey(row.originCountry) === normalizeKey(ORIGIN_COUNTRY)
    && normalizeKey(row.destCountry) === normalizeKey(destCountry)
    && psp >= row.from && psp <= row.to
  ));
}

function getMinimumRow(forwarder, destCountry, psp) {
  const minimumRows = getRateRows(forwarder, destCountry, psp).filter((row) => normalizeKey(row.unit) === 'minimum');
  if (!minimumRows.length) return null;
  minimumRows.sort((a, b) => (a.to - a.from) || (a.from - b.from));
  return minimumRows[0];
}

function findRate(forwarder, destCountry, psp, zone) {
  const tariffRows = getRateRows(forwarder, destCountry, psp).filter((row) => normalizeKey(row.unit) !== 'minimum');
  if (!tariffRows.length) return null;

  tariffRows.sort((a, b) => (a.to - b.to) || (a.from - b.from));
  const rateRow = tariffRows[0];
  const tariffPrice = rateRow.zonePrices.get(zone);
  const minimumRow = getMinimumRow(forwarder, destCountry, psp);
  const minimumPriceRaw = minimumRow ? minimumRow.zonePrices.get(zone) : null;
  const minimumPrice = Number.isFinite(minimumPriceRaw) ? minimumPriceRaw : null;

  if (!Number.isFinite(tariffPrice)) {
    return { tariffPrice: null, minimumPrice, appliedBasePrice: null, priceSource: null };
  }

  const appliedBasePrice = Number.isFinite(minimumPrice) ? Math.max(tariffPrice, minimumPrice) : tariffPrice;
  let priceSource = 'Tarif';
  if (Number.isFinite(minimumPrice) && minimumPrice > tariffPrice) priceSource = 'Mindestfracht';
  if (Number.isFinite(minimumPrice) && minimumPrice === tariffPrice) priceSource = 'Tarif / Mindestfracht';

  return { tariffPrice, minimumPrice, appliedBasePrice, priceSource };
}

function getAncillaryAmount(forwarder, psp, exchangeEnabled) {
  if (!exchangeEnabled) return { amount: 0, label: 'Palettentausch deaktiviert' };
  const config = getAncillaryConfig(forwarder);
  if (!config || config.enabled === false || config.mode === 'disabled') return { amount: 0, label: '—' };
  const amount = Number.isFinite(config.value)
    ? (config.mode === 'per_psp' ? config.value * psp : config.value)
    : 0;
  const detail = config.mode === 'per_psp'
    ? `${config.label}: ${formatNumber(config.value, 2)} € × ${psp}`
    : `${config.label}: Fixpreis`;
  return { amount: round2(amount), label: detail };
}

function buildCalculationForForwarder(forwarder, destCountry, postalCode, psp, exchangeEnabled) {
  const zoneResult = findZone(forwarder, destCountry, postalCode);
  if (!zoneResult) return { forwarder, success: false, reason: 'Keine Zone gefunden.' };

  const rateResult = findRate(forwarder, destCountry, psp, zoneResult.zone);
  if (!rateResult) return { forwarder, success: false, reason: 'Kein Tarifband gefunden.' };
  if (!Number.isFinite(rateResult.appliedBasePrice)) {
    return { forwarder, success: false, reason: `Kein gültiger Preis für Zone ${zoneResult.zone}.` };
  }

  const floaterPercent = getFloaterPercent(forwarder);
  const floaterAmount = round2(rateResult.appliedBasePrice * (floaterPercent / 100));
  const ancillary = getAncillaryAmount(forwarder, psp, exchangeEnabled);
  const total = round2(rateResult.appliedBasePrice + floaterAmount + ancillary.amount);

  return {
    forwarder,
    success: true,
    zone: zoneResult.zone,
    basePrice: rateResult.appliedBasePrice,
    floaterPercent,
    floaterAmount,
    ancillaryAmount: ancillary.amount,
    ancillaryLabel: ancillary.label,
    total,
    priceSource: rateResult.priceSource,
  };
}

function renderEmptyRow(text = 'Noch keine Berechnung.') {
  document.getElementById('resultsBody').innerHTML = `<tr><td colspan="7" class="muted">${text}</td></tr>`;
}

function renderResults(results) {
  const tbody = document.getElementById('resultsBody');
  tbody.innerHTML = '';
  if (!results.length) return renderEmptyRow('Keine berechenbaren Ergebnisse gefunden.');

  results.forEach((result, index) => {
    const tr = document.createElement('tr');
    if (index === 0) tr.className = 'best-row';
    tr.innerHTML = `
      <td>${index === 0 ? '<span class="badge">Günstigster</span>' : ''}<span class="provider">${result.forwarder}</span></td>
      <td>${result.zone}</td>
      <td class="right">${money(result.basePrice)}</td>
      <td class="right">${percent(result.floaterPercent)}<br><span class="hint">${money(result.floaterAmount)}</span></td>
      <td class="right">${money(result.ancillaryAmount)}<br><span class="hint">${result.ancillaryLabel}</span></td>
      <td class="right"><strong>${money(result.total)}</strong></td>
      <td>${result.priceSource}</td>
    `;
    tbody.appendChild(tr);
  });
}

function updatePostalPlaceholder() {
  const country = document.getElementById('destCountry').value;
  document.getElementById('postalCode').placeholder = POSTAL_PLACEHOLDERS[country] || 'z. B. 24939';
}

function showMessage(text, kind = 'success') {
  const box = document.getElementById('messageBox');
  if (!text) {
    box.hidden = true;
    box.textContent = '';
    box.className = 'notice';
    return;
  }
  box.hidden = false;
  box.textContent = text;
  box.className = `notice ${kind}`;
}

function validateInput({ destCountry, postalCode, psp }) {
  if (!destCountry) return 'Bitte zuerst ein Land wählen.';
  if (!postalCode || String(postalCode).trim().length < 2) return 'Bitte eine gültige PLZ eingeben.';
  if (!Number.isFinite(psp) || psp <= 0) return 'Bitte PSP größer 0 eingeben.';
  return null;
}

function diagnoseNoResults(destCountry, postalCode, psp, forwarders) {
  const zoneHits = [];
  const tariffHits = [];
  forwarders.forEach((forwarder) => {
    const zoneResult = findZone(forwarder, destCountry, postalCode);
    if (zoneResult) {
      zoneHits.push({ forwarder, zone: zoneResult.zone });
      const rateResult = findRate(forwarder, destCountry, psp, zoneResult.zone);
      if (rateResult && Number.isFinite(rateResult.appliedBasePrice)) tariffHits.push(forwarder);
    }
  });
  if (!zoneHits.length) return `Keine Zone gefunden. Für ${destCountry} ist die PLZ ${postalCode} aktuell nicht abgedeckt.`;
  if (!tariffHits.length) return `Zone gefunden, aber kein passendes PSP-Tarifband für ${psp} PSP.`;
  return 'Für diese Kombination wurde kein berechenbarer Dienstleister gefunden.';
}

function initUi() {
  const countrySelect = document.getElementById('destCountry');
  const forwarderSelect = document.getElementById('forwarderSelect');
  const form = document.getElementById('calculatorForm');
  const summaryBox = document.getElementById('summaryBox');
  const resultsSection = document.getElementById('resultsSection');

  STATE.countries.forEach((country) => {
    const option = document.createElement('option');
    option.value = country;
    option.textContent = country;
    countrySelect.appendChild(option);
  });

  STATE.forwarders.forEach((forwarder) => {
    const option = document.createElement('option');
    option.value = forwarder;
    option.textContent = forwarder;
    forwarderSelect.appendChild(option);
  });

  countrySelect.addEventListener('change', updatePostalPlaceholder);
  updatePostalPlaceholder();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const destCountry = countrySelect.value;
    const postalCode = document.getElementById('postalCode').value.trim();
    const psp = parseNumberFlexible(document.getElementById('psp').value);
    const selectedForwarder = forwarderSelect.value;
    const exchangeEnabled = document.getElementById('exchangeToggle').checked;

    const validationError = validateInput({ destCountry, postalCode, psp });
    if (validationError) {
      showMessage(validationError, 'danger');
      summaryBox.hidden = true;
      resultsSection.hidden = true;
      renderEmptyRow();
      return;
    }

    const forwarders = selectedForwarder === '__all__' ? STATE.forwarders : [selectedForwarder];
    const successfulResults = [];
    let failedCount = 0;

    forwarders.forEach((forwarder) => {
      const result = buildCalculationForForwarder(forwarder, destCountry, postalCode, psp, exchangeEnabled);
      if (result.success) successfulResults.push(result);
      else failedCount += 1;
    });

    successfulResults.sort((a, b) => a.total - b.total || a.forwarder.localeCompare(b.forwarder, 'de'));

    if (!successfulResults.length) {
      showMessage(diagnoseNoResults(destCountry, postalCode, psp, forwarders), 'danger');
      summaryBox.hidden = true;
      resultsSection.hidden = true;
      renderEmptyRow();
      return;
    }

    renderResults(successfulResults);
    const cheapest = successfulResults[0];
    document.getElementById('summaryCountry').textContent = destCountry;
    document.getElementById('summaryPostal').textContent = postalCode;
    document.getElementById('summaryPsp').textContent = String(psp);
    document.getElementById('summaryCount').textContent = String(successfulResults.length);
    document.getElementById('summaryBest').textContent = `${cheapest.forwarder} (${money(cheapest.total)})`;

    summaryBox.hidden = false;
    resultsSection.hidden = false;
    showMessage(`Berechnung erfolgreich. ${successfulResults.length} Dienstleister gefunden${failedCount ? `, ${failedCount} ohne Treffer` : ''}.`, 'success');
  });

  form.addEventListener('reset', () => {
    setTimeout(() => {
      showMessage('');
      summaryBox.hidden = true;
      resultsSection.hidden = true;
      renderEmptyRow();
      updatePostalPlaceholder();
      document.getElementById('exchangeToggle').checked = true;
    }, 0);
  });
}

async function boot() {
  await Promise.all([loadZones(), loadRates(), loadFloaterConfig(), loadAncillaryConfig()]);
  initUi();
}

window.addEventListener('DOMContentLoaded', () => {
  boot().catch((error) => {
    showMessage(`Fehler beim Laden der Daten: ${error.message}`, 'danger');
    console.error(error);
  });
});
