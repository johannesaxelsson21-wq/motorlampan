// Tolkning av ELM327-svar. Samma logik som webbversionen (../index.html).

export type CodeInfo = { title: string; fix: string };

// Texterna ska kännas lugna och trygga: vanliga, ofta enkla orsaker, inga skrämmande ord.
const TURBO_SLANG = "Det här är vanligt och oftast enkelt. Ofta har en slang till turbon släppt lite, eller så behöver en liten ventil bytas. Verkstaden brukar fixa det snabbt.";
const SENSOR = "En liten givare som mäter trycket. Ibland räcker det att verkstaden gör ren kontakten, annars byter de givaren. Det är en enkel och billig del.";
const WASTEGATE = "En liten ventil som styr turbon. Verkstaden kollar ventilen och slangarna till den, det brukar gå fort.";
const DUMP = "En liten ventil på turbon som slits med tiden. Det är en vanlig och billig del som verkstaden byter snabbt.";

/** Vanliga felkoder med enkel förklaring och möjlig lösning. */
export const INFO: Record<string, CodeInfo> = {
  P0299: { title: "Turbon tar det lite lugnt", fix: TURBO_SLANG },
  P0234: { title: "Turbon har lite för mycket kraft", fix: "Oftast en liten ventil på turbon som behöver röra sig lättare, eller slangen till den. Verkstaden brukar lösa det enkelt." },
  P0235: { title: "Givare för turbon", fix: SENSOR },
  P0236: { title: "Givare för turbon", fix: SENSOR },
  P0237: { title: "Givare för turbon", fix: SENSOR },
  P0238: { title: "Givare för turbon", fix: SENSOR },
  P0243: { title: "Turbons styrventil", fix: WASTEGATE },
  P0244: { title: "Turbons styrventil", fix: WASTEGATE },
  P0245: { title: "Turbons styrventil", fix: WASTEGATE },
  P0246: { title: "Turbons styrventil", fix: WASTEGATE },
  P0033: { title: "Turbons lilla ventil", fix: DUMP },
  P0034: { title: "Turbons lilla ventil", fix: DUMP },
  P0035: { title: "Turbons lilla ventil", fix: DUMP },
  P2261: { title: "Turbons lilla ventil", fix: DUMP },
  P2263: { title: "Turbon tar det lite lugnt", fix: TURBO_SLANG },
  P2563: { title: "Givare på turbon", fix: "En givare på turbon. Verkstaden tittar på den och vet vad som behövs." },
  P0045: { title: "Turbons styrning", fix: WASTEGATE },
  P0046: { title: "Turbons styrning", fix: WASTEGATE },
  P0101: { title: "Luftmätaren", fix: "Mätaren som känner hur mycket luft motorn får behöver ofta bara göras ren. Verkstaden kollar samtidigt luftfiltret." },
  P0171: { title: "Luft och bränsle", fix: "Motorn får lite för mycket luft. Oftast en liten slang som släppt, något verkstaden fixar enkelt." },
  P0300: { title: "Tändningen", fix: "Oftast ett tändstift som har gjort sitt, en vanlig och billig del. Boka gärna en tid på verkstaden inom kort." },
  P0401: { title: "En ventil för avgaserna", fix: "Ventilen brukar bara behöva göras ren. Det är en vanlig sak som verkstaden känner väl till." },
  P0420: { title: "Avgasreningen", fix: "Ingen brådska. Nämn det för verkstaden vid nästa service, eller innan besiktningen." },
};

/** Förklaring för en kod. Okända koder får en allmän lugn text utifrån kodens grupp. */
export function codeInfo(code: string): CodeInfo {
  if (INFO[code]) return INFO[code];
  const g = code.slice(0, 3);
  if (g === "P03") return { title: "Tändningen", fix: "Oftast ett tändstift eller en tändspole, vanliga och billiga delar. Boka gärna en tid på verkstaden inom kort." };
  if (g === "P01" || g === "P02") return { title: "Luft och bränsle", fix: "Oftast en liten givare eller slang. Nämn koden för verkstaden, så vet de var de ska titta." };
  if (g === "P04") return { title: "Avgasreningen", fix: "Ingen brådska. Nämn det för verkstaden vid nästa service." };
  if (g === "P07") return { title: "Växellådan", fix: "Nämn koden för verkstaden, så tittar de på det i lugn och ro." };
  if (code[0] === "U") return { title: "Bilens elektronik", fix: "Bilens datorer har tappat kontakten med varandra en kort stund. Det är ofta helt tillfälligt." };
  return { title: "En mindre vanlig kod", fix: "Visa koden för verkstaden, så slår de upp vad den betyder för just din bil." };
}

export function decodeDTC(w: string): string {
  const b = parseInt(w, 16);
  return "PCBU"[b >> 14] + ((b >> 12) & 3) + (b & 0xfff).toString(16).toUpperCase().padStart(3, "0");
}

/** Tolkar svar på läge 03. isCan = undefined → gissa utifrån längden. */
export function parseDTCs(raw: string, isCan?: boolean): string[] {
  const lines = raw.split(/[\r\n]+/).map(l => l.replace(/\s+/g, "").toUpperCase())
    .filter(l => l && /^[0-9A-F:]+$/.test(l));
  type Msg = { len?: number; data: string };
  const msgs: Msg[] = [];
  let multi: Msg | null = null;
  for (const l of lines) {
    if (/^[0-9A-F]{3}$/.test(l)) { multi = { len: parseInt(l, 16), data: "" }; msgs.push(multi); continue; }
    const m = l.match(/^([0-9A-F]):([0-9A-F]*)$/);
    if (m && multi) { multi.data += m[2]; continue; }
    multi = null; msgs.push({ data: l });
  }
  const codes = new Set<string>();
  for (const msg of msgs) {
    let d = msg.len ? msg.data.slice(0, msg.len * 2) : msg.data;
    if (!d.startsWith("43")) continue;
    d = d.slice(2);
    const can = isCan === undefined ? d.length % 4 === 2 : isCan;
    if (can) { const n = parseInt(d.slice(0, 2), 16); d = d.slice(2, 2 + n * 4); }
    for (let i = 0; i + 4 <= d.length; i += 4) {
      const w = d.slice(i, i + 4);
      if (w !== "0000") codes.add(decodeDTC(w));
    }
  }
  return [...codes];
}

/** ATDPN-svar ("A6", "6", "3" …) → är protokollet CAN? */
export function protocolIsCan(dpn: string): boolean | undefined {
  const n = dpn.replace(/[^0-9A-F]/gi, "").toUpperCase().slice(-1);
  return n ? /[6-9A-C]/.test(n) : undefined;
}

export function isBusError(r: string): boolean {
  return /UNABLE TO CONNECT|CAN ERROR|BUS ERROR|BUS INIT:.*ERROR|STOPPED|ERROR/i.test(r);
}

export function answered0100(r: string): boolean {
  return !isBusError(r) && /4100/i.test(r.replace(/\s/g, ""));
}

export function clearedOk(r: string): boolean {
  return /44/.test(r.replace(/\s/g, ""));
}
