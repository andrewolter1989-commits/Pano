let currentTransport = 'teilladung';

function normalizePostalCode(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function toNumber(value) {
  const normalized = String(value ?? '')
    .replace(/\./g, '')
    .replace(',', '.')
    .trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function parseCSV(text) {
  const rows = [];
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return rows;

  const headers = splitCSVLine(lines[0]).map(h => h.trim());
  for (let i = 1; i < lines.length; i += 1) {
    const values = splitCSVLine(lines[i]);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = (values[index] ?? '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function splitCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

async function loadData() {
  const [rates, zones, floater, ancillary] = await Promise.all([
    fetch('rates.csv').then(r => r.text()),
    fetch('zones.csv').then(r => r.text()),
    fetch('floater.json').then(r => r.json()),
    fetch('ancillary.json').then(r => r.json()),
  ]);

  return {
    rates: parseCSV(rates),
    zones: parseCSV(zones),
    floater,
    ancillary,
  };
}

function findZone(zones, plz) {
  const numericPlz = Number(plz);
  return zones.find((row) => {
    const from = Number(row.from ?? row.From ?? row.PLZ_From ?? row.plz_from);
    const to = Number(row.to ?? row.To ?? row.PLZ_To ?? row.plz_to);
    return Number.isFinite(from) && Number.isFinite(to) && numericPlz >= from && numericPlz <= to;
  });
}

function formatCurrency(value) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
}

function formatPercent(value) {
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value * 100) + ' %';
}

function showMessage(text, type) {
  const el = document.getElementById('message');
  el.textContent = text;
  el.className = `message ${type}`;
}

function clearMessage() {
  const el = document.getElementById('message');
  el.textContent = '';
  el.className = 'message hidden';
}

function setTransport(mode) {
  currentTransport = mode;
  document.querySelectorAll('.transport-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  const pspInput = document.getElementById('psp');
  if (mode === 'ftl') {
    pspInput.value = 34;
    pspInput.readOnly = true;
  } else {
    pspInput.readOnly = false;
    if (Number(pspInput.value) === 34) pspInput.value = 1;
  }
}

function resetForm() {
  document.getElementById('plz').value = '';
  document.getElementById('psp').value = 1;
  document.getElementById('psp').readOnly = false;
  setTransport('teilladung');
  document.getElementById('resultsBody').innerHTML = '';
  document.getElementById('resultsSection').classList.add('hidden');
  document.getElementById('summary').classList.add('hidden');
  clearMessage();
}

function buildResultRow(result, index) {
  const tr = document.createElement('tr');
  if (index === 0) tr.classList.add('best-row');

  const providerCell = index === 0
    ? `<div class="provider-cell"><span class="badge">Günstigster</span><strong>${result.forwarder}</strong></div>`
    : `<div class="provider-cell"><strong>${result.forwarder}</strong></div>`;

  tr.innerHTML = `
    <td>${providerCell}</td>
    <td>${result.zone}</td>
    <td>${formatCurrency(result.base)}</td>
    <td>${formatPercent(result.dieselRate)}</td>
    <td>${formatCurrency(result.diesel)}</td>
    <td>${formatCurrency(result.pallet)}</td>
    <td class="price-strong">${formatCurrency(result.total)}</td>
  `;
  return tr;
}

async function calculate() {
  clearMessage();

  const plz = normalizePostalCode(document.getElementById('plz').value);
  const psp = Number(document.getElementById('psp').value);

  if (!plz || !/^\d+$/.test(plz)) {
    showMessage('Bitte eine gültige numerische PLZ eingeben.', 'error');
    return;
  }

  if (!Number.isFinite(psp) || psp < 1) {
    showMessage('Bitte eine gültige Palettenanzahl eingeben.', 'error');
    return;
  }

  try {
    const data = await loadData();
    const zoneRow = findZone(data.zones, plz);

    if (!zoneRow) {
      document.getElementById('resultsBody').innerHTML = '';
      document.getElementById('resultsSection').classList.add('hidden');
      document.getElementById('summary').classList.add('hidden');
      showMessage(`Keine Zone gefunden. Für die PLZ ${plz} liegt aktuell keine Zuordnung vor.`, 'error');
      return;
    }

    const zone = zoneRow.zone ?? zoneRow.Zone ?? zoneRow.ZONE ?? '';
    const results = [];

    data.rates.forEach((row) => {
      const from = Number(row.from ?? row.From ?? row.CHG_from ?? row['CHG from']);
      const to = Number(row.to ?? row.To ?? row.CHG_to ?? row['CHG to']);
      const price = toNumber(row.price ?? row.Price ?? row.Preis);
      const forwarder = row.forwarder ?? row.Forwarder ?? row.Dienstleister;

      if (!forwarder || !Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(price)) return;
      if (price >= 99999) return;
      if (!(psp >= from && psp <= to)) return;

      const dieselRate = Number(data.floater[forwarder] || 0);
      const diesel = price * dieselRate;
      const ancillary = data.ancillary[forwarder];
      let pallet = 0;

      if (ancillary && ancillary.enabled) {
        if (ancillary.mode === 'per_psp') pallet = Number(ancillary.value || 0) * psp;
        if (ancillary.mode === 'fixed') pallet = Number(ancillary.value || 0);
      }

      results.push({
        forwarder,
        zone,
        base: price,
        dieselRate,
        diesel,
        pallet,
        total: price + diesel + pallet,
      });
    });

    results.sort((a, b) => a.total - b.total);

    if (!results.length) {
      document.getElementById('resultsBody').innerHTML = '';
      document.getElementById('resultsSection').classList.add('hidden');
      document.getElementById('summary').classList.add('hidden');
      showMessage('Für diese Eingabe wurde kein passender Tarif gefunden.', 'error');
      return;
    }

    showMessage(`Berechnung erfolgreich. ${results.length} Dienstleister gefunden.`, 'success');

    document.getElementById('summaryPlz').textContent = plz;
    document.getElementById('summaryTransport').textContent = currentTransport === 'ftl' ? 'FTL' : 'Teilladung';
    document.getElementById('summaryPallets').textContent = String(psp);
    document.getElementById('summaryCount').textContent = String(results.length);
    document.getElementById('summaryBest').textContent = `${results[0].forwarder} (${formatCurrency(results[0].total)})`;
    document.getElementById('summary').classList.remove('hidden');

    const body = document.getElementById('resultsBody');
    body.innerHTML = '';
    results.forEach((result, index) => body.appendChild(buildResultRow(result, index)));
    document.getElementById('resultsSection').classList.remove('hidden');
  } catch (error) {
    console.error(error);
    showMessage('Die Daten konnten nicht geladen werden. Bitte die CSV-/JSON-Dateien prüfen.', 'error');
  }
}

document.getElementById('calculateBtn').addEventListener('click', calculate);
document.getElementById('resetBtn').addEventListener('click', resetForm);
document.querySelectorAll('.transport-btn').forEach((btn) => {
  btn.addEventListener('click', () => setTransport(btn.dataset.mode));
});

setTransport('teilladung');
