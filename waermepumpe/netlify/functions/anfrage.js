// Anfrage-Formular der Wärmepumpen-Landingpage (waermepumpe.jranner.de)
// 1. speichert die Anfrage in Supabase (Tabelle "leads", Projekt "JR Smart Tools", Frankfurt)
// 2. schickt eine Mail an das Büro (Resend)
//
// Umgebungsvariablen in Netlify (wie bei bad.jranner.de):
//   RESEND_API_KEY        – Pflicht für den Mailversand
//   MAIL_TO               – optional, Standard info@jranner.de
//   MAIL_FROM             – Absenderadresse, z. B. info@jranner.de (in Resend verifiziert);
//                           der Absendername wird immer auf die Firmierung FIRMA gesetzt
//   SUPABASE_URL          – optional, Standard https://wwpfxnjsvzhtfsznoxto.supabase.co
//   SUPABASE_SERVICE_KEY  – Pflicht für das Speichern in der Datenbank

// Einzugsgebiet: ca. 20 km um Hergolding
const FIRMA = 'J. Ranner – Bad & Dusche | Armaturenservice & Sanitärfachgeschäft GmbH';

const ORTE = {
  '85591':'Vaterstetten','85598':'Baldham','85599':'Hergolding/Parsdorf','85586':'Poing','85604':'Zorneding',
  '85551':'Kirchheim/Heimstetten','85630':'Grasbrunn','85540':'Haar','85609':'Aschheim','85622':'Feldkirchen',
  '85652':'Pliening','85635':'Höhenkirchen-Siegertsbrunn','85570':'Markt Schwaben','85614':'Kirchseeon',
  '85521':'Ottobrunn','85579':'Neubiberg','85662':'Hohenbrunn','85567':'Grafing','85560':'Ebersberg',
  '85661':'Forstinning','85646':'Anzing','85737':'Ismaning','85774':'Unterföhring',
  '81827':'München-Trudering','81829':'München-Messestadt','81825':'München-Trudering','81735':'München-Ramersdorf',
  '81739':'München-Neuperlach','85640':'Putzbrunn','85653':'Aying','85649':'Brunnthal'
};

const esc = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cut = (s, n) => String(s || '').trim().slice(0, n);

async function send(key, payload) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

async function saveLead(row) {
  const url = process.env.SUPABASE_URL || 'https://wwpfxnjsvzhtfsznoxto.supabase.co';
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) { console.error('SUPABASE_SERVICE_KEY fehlt'); return false; }
  try {
    const r = await fetch(`${url}/rest/v1/leads`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row)
    });
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
    return true;
  } catch (e) { console.error(e); return false; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let d;
  try { d = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Ungültige Daten' }; }

  // Spam-Falle: verstecktes Feld "firma" bleibt bei Menschen leer
  if (d.firma) { console.log('Spam-Falle ausgelöst, Anfrage verworfen'); return { statusCode: 200, body: 'ok' }; }

  const telDigits = String(d.telefon || '').replace(/\D/g, '');
  if (!d.name || telDigits.length < 6 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email || '') || !/^\d{5}$/.test(d.plz || '')) {
    return { statusCode: 400, body: 'Pflichtfelder fehlen' };
  }

  const ort = cut(d.ort, 80) || ORTE[d.plz] || '';
  const imGebiet = !!ORTE[d.plz];
  const q = d.quelle || {};
  const quelle = [q.utm_source, q.utm_campaign, q.utm_content].filter(Boolean).join(' / ') || (q.fbclid ? 'Meta (fbclid)' : 'direkt / unbekannt');
  const telLink = '+49' + telDigits.replace(/^0049/, '').replace(/^49/, '').replace(/^0/, '');

  // Gebäude, Heizung und Alter landen gemeinsam in der Spalte "umfang"
  const umfang = [d.gebaeude, d.heizung, d.alter ? `Heizung ${d.alter} alt` : ''].filter(Boolean).join(' · ');

  // 1. In der Anfragen-Liste speichern
  const saved = await saveLead({
    kampagne: 'waermepumpe', variante: cut(d.variante, 40) || null,
    umfang: cut(umfang, 300) || null, zeitraum: cut(d.zeitraum, 80) || null,
    plz: d.plz, ort: ort || null, eigentum: cut(d.eigentum, 80) || null,
    name: cut(d.name, 120), telefon: cut(d.telefon, 40), email: cut(d.email, 160), nachricht: cut(d.nachricht, 2000) || null,
    utm_source: cut(q.utm_source, 120) || null, utm_medium: cut(q.utm_medium, 120) || null,
    utm_campaign: cut(q.utm_campaign, 120) || null, utm_content: cut(q.utm_content, 120) || null, fbclid: cut(q.fbclid, 300) || null
  });

  // 2. Mail an das Büro
  const key = process.env.RESEND_API_KEY;
  const to = process.env.MAIL_TO || 'info@jranner.de';
  const fromAdresse = (String(process.env.MAIL_FROM || '').match(/[^\s<>"]+@[^\s<>"]+/) || ['onboarding@resend.dev'])[0];
  const from = `"${FIRMA}" <${fromAdresse}>`;
  const subject = `Neue Anfrage Wärmepumpe – ${d.plz} ${ort}${imGebiet ? '' : ' (außerhalb Gebiet)'} – ${d.zeitraum || '?'}`;
  const rows = [
    ['Gebäude', d.gebaeude], ['Heizung heute', d.heizung], ['Alter Heizung', d.alter], ['Zeitraum', d.zeitraum],
    ['PLZ / Ort', `${d.plz} ${ort}${imGebiet ? '' : ' ⚠ außerhalb des Einzugsgebiets'}`], ['Nutzung', d.eigentum],
    ['Name', d.name], ['Telefon', `<a href="tel:${telLink}">${esc(d.telefon)}</a>`], ['E-Mail', `<a href="mailto:${esc(d.email)}">${esc(d.email)}</a>`],
    ['Nachricht', d.nachricht], ['Anzeige / Quelle', quelle], ['Variante', d.variante]
  ];
  const html = `<h2 style="font-family:Arial,sans-serif;color:#1d3a2a">Neue Anfrage Wärmepumpe</h2>
<table style="font-family:Arial,sans-serif;font-size:15px;border-collapse:collapse">
${rows.map(([k, v]) => `<tr><td style="padding:6px 16px 6px 0;color:#5d6a62;vertical-align:top">${k}</td><td style="padding:6px 0">${k === 'Telefon' || k === 'E-Mail' ? v : esc(v) || '–'}</td></tr>`).join('\n')}
</table>
<p style="font-family:Arial,sans-serif;font-size:13px;color:#5d6a62">${saved ? 'In der Anfragen-Liste gespeichert (Status: neu).' : 'Achtung: konnte nicht in der Anfragen-Liste gespeichert werden.'}</p>`;

  let mailed = false;
  try {
    if (!key) throw new Error('RESEND_API_KEY fehlt');
    await send(key, { from, to: [to], reply_to: d.email, subject, html });
    mailed = true;
  } catch (e) { console.error(e); }

  if (!saved && !mailed) return { statusCode: 502, body: 'Anfrage konnte nicht übermittelt werden' };

  // 3. Bestätigung an den Kunden – nur mit eigener Absenderadresse (MAIL_FROM, in Resend verifiziert)
  if (key && process.env.MAIL_FROM) {
    try {
      const anrede = esc(cut(d.name, 120));
      await send(key, {
        from, to: [d.email], reply_to: to,
        subject: `Ihre Anfrage zur Wärmepumpe bei ${FIRMA}`,
        html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#1f2a24;max-width:560px">
          <p>Guten Tag ${anrede},</p>
          <p>vielen Dank für Ihre Anfrage zu einer neuen Wärmepumpe. Wir haben alles erhalten und melden uns in der Regel innerhalb eines Werktags telefonisch bei Ihnen, um einen Termin vor Ort zu vereinbaren.</p>
          <p>Tipp für das Telefonat: Halten Sie, wenn möglich, Ihren Heizöl- oder Gasverbrauch der letzten Jahre bereit.</p>
          <p>Falls Sie vorher etwas ergänzen möchten, antworten Sie einfach auf diese Mail oder rufen Sie uns an: 089/43909732.</p>
          <p>Mit freundlichen Grüßen<br>Ihr Team von J. RANNER Energielösungen<br>${esc(FIRMA)}<br>Parsdorfer Straße 19, 85599 Vaterstetten</p></div>`
      });
    } catch (e) { console.error('Bestätigung fehlgeschlagen', e); }
  }
  return { statusCode: 200, body: 'ok' };
};
