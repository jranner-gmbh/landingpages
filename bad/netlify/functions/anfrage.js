// Netlify Function: neue Anfrage von der Bad-Landingpage per Resend an info@jranner.de
// Umgebungsvariablen (Netlify -> Site configuration -> Environment variables):
//   RESEND_API_KEY  (Pflicht)
//   MAIL_TO         (optional, Standard: info@jranner.de)
//   SUPABASE_SERVICE_KEY (Pflicht für die Anfragen-Liste; Supabase -> Project Settings -> API Keys -> service_role / secret)
//   SUPABASE_URL    (optional, Standard: Projekt "JR Smart Tools", Region Frankfurt)
//   MAIL_FROM       (optional, z. B. "info@jranner.de" — erst nach Domain-Verifizierung in Resend;
//                    der Absendername wird immer auf die Firmierung FIRMA gesetzt)
// Ohne MAIL_FROM wird über onboarding@resend.dev gesendet; dann geht KEINE Bestätigung an den Kunden raus.

const ORTE = {
  '85591':'Vaterstetten','85598':'Baldham','85599':'Hergolding/Parsdorf','85586':'Poing','85604':'Zorneding',
  '85551':'Kirchheim','85630':'Grasbrunn','85540':'Haar','85609':'Aschheim','85622':'Feldkirchen',
  '85652':'Pliening','85635':'Höhenkirchen-Siegertsbrunn','85570':'Markt Schwaben','85614':'Kirchseeon',
  '85521':'Ottobrunn','85579':'Neubiberg','85662':'Hohenbrunn','85567':'Grafing','85560':'Ebersberg',
  '85661':'Forstinning','85646':'Anzing','85737':'Ismaning','85774':'Unterföhring','85716':'Unterschleißheim',
  '81827':'München-Trudering','81829':'München-Messestadt','81825':'München-Trudering','81735':'München-Ramersdorf',
  '81739':'München-Neuperlach','85640':'Putzbrunn','85653':'Aying','85649':'Brunnthal'
};

const FIRMA = 'J. Ranner – Bad & Dusche | Armaturenservice & Sanitärfachgeschäft GmbH';

const esc = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function saveLead(d, ort) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) { console.warn('SUPABASE_SERVICE_KEY fehlt – Anfrage nicht gespeichert'); return false; }
  const url = (process.env.SUPABASE_URL || 'https://wwpfxnjsvzhtfsznoxto.supabase.co') + '/rest/v1/leads';
  const q = d.quelle || {};
  const row = {
    kampagne: d.kampagne || 'badsanierung', variante: d.variante || null,
    umfang: d.umfang || null, groesse: d.groesse || null, zeitraum: d.zeitraum || null,
    plz: d.plz, ort: ort || null, eigentum: d.eigentum || null,
    name: d.name, telefon: d.telefon, email: d.email, nachricht: d.nachricht || null,
    utm_source: q.utm_source || null, utm_medium: q.utm_medium || null,
    utm_campaign: q.utm_campaign || null, utm_content: q.utm_content || null, fbclid: q.fbclid || null
  };
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row)
    });
    if (!r.ok) { console.error('Supabase', r.status, await r.text()); return false; }
    return true;
  } catch (e) { console.error('Supabase', e); return false; }
}

async function send(key, payload) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let d;
  try { d = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Ungültige Daten' }; }

  // Spam-Falle: verstecktes Feld "hp_kontrolle" (übertragen als d.firma) bleibt bei Menschen leer
  if (d.firma) { console.log('Spam-Falle ausgelöst, Anfrage verworfen'); return { statusCode: 200, body: 'ok' }; }

  const telDigits = String(d.telefon || '').replace(/\D/g, '');
  if (!d.name || telDigits.length < 6 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email || '') || !/^\d{5}$/.test(d.plz || '')) {
    return { statusCode: 400, body: 'Pflichtfelder fehlen' };
  }

  const key = process.env.RESEND_API_KEY;
  const to = process.env.MAIL_TO || 'info@jranner.de';
  const fromAdresse = (String(process.env.MAIL_FROM || '').match(/[^\s<>"]+@[^\s<>"]+/) || ['onboarding@resend.dev'])[0];
  const from = `"${FIRMA}" <${fromAdresse}>`;

  const ort = d.ort || ORTE[d.plz] || '';
  const imGebiet = !!ORTE[d.plz];
  const q = d.quelle || {};
  const quelle = [q.utm_source, q.utm_campaign, q.utm_content].filter(Boolean).join(' / ') || (q.fbclid ? 'Meta (fbclid)' : 'direkt / unbekannt');
  const telLink = '+49' + telDigits.replace(/^0049/, '').replace(/^49/, '').replace(/^0/, '');

  const subject = `Neue Anfrage Badsanierung – ${d.plz} ${ort} – Start: ${d.zeitraum || '?'}`;
  const rows = [
    ['Was', d.umfang], ['Größe', d.groesse], ['Start', d.zeitraum],
    ['PLZ / Ort', `${d.plz} ${ort}${imGebiet ? '' : '  ⚠ außerhalb der bekannten PLZ-Liste, bitte prüfen'}`],
    ['Eigentum', d.eigentum], ['Name', d.name],
    ['Telefon', `<a href="tel:${esc(telLink)}">${esc(d.telefon)}</a>`],
    ['E-Mail', `<a href="mailto:${esc(d.email)}">${esc(d.email)}</a>`],
    ['Nachricht', d.nachricht || '–'],
    ['Kam über', quelle], ['Seitenvariante', d.variante]
  ];
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#18203d">
    <h2 style="color:#1e2d6b;margin:0 0 6px">Neue Anfrage Badsanierung</h2>
    <p style="margin:0 0 16px;color:#5b6585">Bitte möglichst heute zurückrufen. Schnelle Rückrufe gewinnen deutlich öfter.</p>
    <table cellpadding="7" style="border-collapse:collapse;border:1px solid #dbe2ec">
    ${rows.map(([k, v]) => `<tr><td style="background:#f4f7fa;border:1px solid #dbe2ec;font-weight:bold;white-space:nowrap">${k}</td><td style="border:1px solid #dbe2ec">${k === 'Telefon' || k === 'E-Mail' ? v : esc(v)}</td></tr>`).join('')}
    </table>
    <p style="font-size:12px;color:#8a93ad;margin-top:16px">Eingegangen am ${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} über ${esc(d.seite)}</p></div>`;

  // 1. In der Anfragen-Liste speichern (Supabase, Frankfurt)
  const saved = await saveLead(d, ort);

  // 2. Mail an das Büro
  let mailed = false;
  try {
    if (!key) throw new Error('RESEND_API_KEY fehlt');
    await send(key, { from, to: [to], reply_to: d.email, subject, html });
    mailed = true;
  } catch (e) { console.error(e); }

  // Nur wenn beides scheitert, bekommt der Kunde eine Fehlermeldung
  if (!saved && !mailed) return { statusCode: 502, body: 'Anfrage konnte nicht übermittelt werden' };

  // Bestätigung an den Kunden nur mit verifizierter Absender-Domain
  if (process.env.MAIL_FROM) {
    const vorname = esc(String(d.name).split(' ')[0]);
    try {
      await send(key, {
        from, to: [d.email], reply_to: to,
        subject: `Deine Anfrage bei ${FIRMA}`,
        html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#18203d;line-height:1.5">
          <p>Hallo ${vorname},</p>
          <p>danke für Deine Anfrage zur Badsanierung. Wir haben alles erhalten und melden uns in der Regel innerhalb eines Werktags telefonisch bei Dir, um einen Termin vor Ort zu vereinbaren.</p>
          <p>Falls Du vorher etwas ergänzen möchtest, antworte einfach auf diese Mail oder ruf uns an: 089/43909732.</p>
          <p>Viele Grüße<br>Dein Team von ${esc(FIRMA)}<br>Parsdorfer Straße 19, 85599 Vaterstetten</p></div>`
      });
    } catch (e) { console.error('Bestätigung fehlgeschlagen', e); }
  }

  return { statusCode: 200, body: 'ok' };
};
