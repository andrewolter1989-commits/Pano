async function loadData() {
  const rates = await fetch('rates.csv').then(r => r.text());
  const zones = await fetch('zones.csv').then(r => r.text());
  const floater = await fetch('floater.json').then(r => r.json());
  const ancillary = await fetch('ancillary.json').then(r => r.json());

  return { rates, zones, floater, ancillary };
}

function parseCSV(text) {
  const lines = text.split('\n');
  const headers = lines[0].split(',');
  return lines.slice(1).map(l => {
    const obj = {};
    l.split(',').forEach((v,i)=>obj[headers[i]]=v);
    return obj;
  });
}

async function calculate() {
  const plz = document.getElementById('plz').value;
  const psp = parseInt(document.getElementById('psp').value);

  const data = await loadData();
  const rates = parseCSV(data.rates);
  const zones = parseCSV(data.zones);

  const zoneRow = zones.find(z => plz >= z.from && plz <= z.to);

  if(!zoneRow){
    document.getElementById('error').innerText = "Keine Zone gefunden";
    return;
  }

  const zone = zoneRow.zone;
  const results = [];

  rates.forEach(r => {
    if(psp >= r.from && psp <= r.to){
      const base = parseFloat(r.price);
      if(base >= 99999) return;

      const dieselRate = data.floater[r.forwarder] || 0;
      const diesel = base * dieselRate;

      const anc = data.ancillary[r.forwarder];
      let pallet = 0;

      if(anc && anc.enabled){
        if(anc.mode === "per_psp") pallet = anc.value * psp;
        if(anc.mode === "fixed") pallet = anc.value;
      }

      const total = base + diesel + pallet;

      results.push({
        forwarder: r.forwarder,
        zone,
        base,
        diesel,
        pallet,
        total
      });
    }
  });

  results.sort((a,b)=>a.total-b.total);

  const container = document.getElementById("results");
  container.innerHTML = "";

  results.forEach((r,i)=>{
    const div = document.createElement("div");
    div.className = "result-row" + (i===0 ? " best":"");
    div.innerHTML = `
      <div>${r.forwarder}</div>
      <div>${r.zone}</div>
      <div>${r.base.toFixed(2)}€</div>
      <div>${r.diesel.toFixed(2)}€</div>
      <div>${r.pallet.toFixed(2)}€</div>
      <div><strong>${r.total.toFixed(2)}€</strong></div>
    `;
    container.appendChild(div);
  });
}

function resetForm(){
  document.getElementById('plz').value="";
  document.getElementById('psp').value=1;
  document.getElementById('results').innerHTML="";
}
