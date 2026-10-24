// Kurzbewerbung karriere.jranner.de – speichert in Supabase (Tabelle bewerbungen) und mailt an das Büro
// Umgebungsvariablen: RESEND_API_KEY, SUPABASE_SERVICE_KEY, MAIL_FROM, optional MAIL_TO, SUPABASE_URL

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wwpfxnjsvzhtfsznoxto.supabase.co";
const MAIL_TO = process.env.MAIL_TO || "info@jranner.de";

const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const json = (code, obj) => ({ statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { ok: false });
  let d;
  try { d = JSON.parse(event.body || "{}"); } catch { return json(400, { ok: false }); }

  // 1. Spam-Feld
  if (d.hp_kontrolle) { console.log("Spam-Feld gefüllt, verworfen"); return json(200, { ok: true }); }

  // 2. Pflichtfelder
  const name = String(d.name || "").trim();
  const telefon = String(d.telefon || "").trim();
  const email = String(d.email || "").trim();
  const plz = String(d.plz || "").trim();
  if (name.length < 3 || telefon.replace(/\D/g, "").length < 6 || !/^\d{5}$/.test(plz) ||
      (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) {
    return json(400, { ok: false, fehler: "Pflichtfelder" });
  }

  const zeile = {
    kampagne: d.kampagne || "recruiting",
    stelle: d.stelle || "", ausbildung: d.ausbildung || "", erfahrung: d.erfahrung || "",
    schwerpunkt: d.schwerpunkt || "", fuehrerschein: d.fuehrerschein || "", zeitraum: d.zeitraum || "",
    erreichbar: d.erreichbar || "", plz, name, telefon, email, nachricht: String(d.nachricht || "").slice(0, 2000),
    utm_source: d.utm_source || "", utm_medium: d.utm_medium || "", utm_campaign: d.utm_campaign || "",
    utm_content: d.utm_content || "", fbclid: d.fbclid || ""
  };

  // 3. Supabase
  let gespeichert = false;
  if (process.env.SUPABASE_SERVICE_KEY) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/bewerbungen`, {
        method: "POST",
        headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
                   "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(zeile)
      });
      gespeichert = r.ok;
      if (!r.ok) console.error("Supabase", r.status, await r.text());
    } catch (e) { console.error("Supabase", e); }
  }

  // 4. Mail ans Büro
  const quelle = [zeile.utm_source, zeile.utm_medium, zeile.utm_campaign].filter(Boolean).join(" / ") || "direkt";
  const reihen = [
    ["Stelle", zeile.stelle], ["Name", name], ["Telefon", telefon], ["E-Mail", email || "–"], ["PLZ Wohnort", plz],
    ["Erreichbar", zeile.erreichbar || "–"], ["Ausbildung", zeile.ausbildung], ["Erfahrung", zeile.erfahrung],
    ["Schwerpunkt", zeile.schwerpunkt], ["Führerschein B", zeile.fuehrerschein], ["Start", zeile.zeitraum],
    ["Nachricht", zeile.nachricht || "–"], ["Quelle", quelle]
  ].map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#5d6b85">${k}</td><td style="padding:6px 0"><b>${esc(v)}</b></td></tr>`).join("");

  let gemailt = false;
  if (process.env.RESEND_API_KEY) {
    const send = (payload) => fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    try {
      const r = await send({
        from: process.env.MAIL_FROM || "J. Ranner <info@jranner.de>",
        to: [MAIL_TO],
        ...(email ? { reply_to: email } : {}),
        subject: `Neue Kurzbewerbung – ${zeile.stelle} – ${name} – PLZ ${plz} – Start: ${zeile.zeitraum || "?"}`,
        html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#193154"><h2 style="margin:0 0 12px">Neue Kurzbewerbung über karriere.jranner.de</h2><p>Bitte zeitnah zurückrufen (Bewerber erwartet Rückruf, meist innerhalb von zwei Werktagen).</p><table>${reihen}</table><p style="color:#5d6b85;font-size:13px;margin-top:16px">Bewerberdaten vertraulich behandeln. Nach Absage spätestens nach 6 Monaten löschen.</p></div>`
      });
      gemailt = r.ok;
      if (!r.ok) console.error("Resend", r.status, await r.text());

      // 5. Bestätigung an Bewerber
      if (email && process.env.MAIL_FROM) {
        await send({
          from: process.env.MAIL_FROM, to: [email], reply_to: "info@jranner.de",
          subject: "Danke für Deine Kurzbewerbung – J. Ranner – Bad & Dusche",
          html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#193154"><p>Hallo ${esc(name.split(" ")[0])},</p><p>danke für Deine Kurzbewerbung als ${esc(zeile.stelle)}. Wir melden uns telefonisch bei Dir, meist innerhalb von zwei Werktagen.</p><p>Eilig? Ruf uns einfach an: 089/43909732</p><p>Viele Grüße<br>Dein Team J. Ranner</p><p style="color:#5d6b85;font-size:13px">J. Ranner – Bad &amp; Dusche | Armaturenservice &amp; Sanitärfachgeschäft GmbH · Parsdorfer Straße 19 · 85599 Vaterstetten · 089/43909732 · info@jranner.de · www.jranner.de</p></div>`
        }).catch((e) => console.error("Bestätigung", e));
      }
    } catch (e) { console.error("Resend", e); }
  }

  // 6. Fehler nur, wenn beides scheitert
  if (!gespeichert && !gemailt) return json(500, { ok: false });
  return json(200, { ok: true });
};
