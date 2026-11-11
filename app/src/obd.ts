// Tolkning av ELM327-svar. Samma logik som webbversionen (../index.html).

export type CodeInfo = { title: string; fix: string };

const TURBO_SLANG = "Vanligaste orsaken är en lös eller sprucken turboslang, eller en trasig dumpventil. Oftast billigt att laga: be verkstaden kolla slangarna mellan turbon och motorn.";
const SENSOR = "Givaren, eller kontakten och kabeln till den. Ibland räcker det att rengöra kontakten, annars byts givaren (en ganska billig del).";
const WASTEGATE = "Turbons styrventil (wastegate), dess kontakt eller vakuumslangen till den. Verkstaden kan testa ventilen och slangarna.";
const DUMP = "Dumpventilen (bypass-ventilen) kan ha fått ett sprucket membran. Det är en vanlig och billig reservdel.";

/** Vanliga felkoder med enkel förklaring och möjlig lösning. */
export const INFO: Record<string, CodeInfo> = {
  P0299: { title: "Turbo: för lågt laddtryck", fix: TURBO_SLANG },
  P0234: { title: "Turbo: för högt laddtryck", fix: "Ofta kärvar wastegate-ventilen eller så läcker vakuumslangen till den. Det kan också vara laddtrycksgivaren. Verkstaden kan testa ventilen." },
  P0235: { title: "Laddtrycksgivare", fix: SENSOR },
  P0236: { title: "Laddtrycksgivare: orimligt värde", fix: SENSOR },
  P0237: { title: "Laddtrycksgivare: låg signal", fix: SENSOR },
  P0238: { title: "Laddtrycksgivare: hög signal", fix: SENSOR },
  P0243: { title: "Turbons styrventil", fix: WASTEGATE },
  P0244: { title: "Turbons styrventil", fix: WASTEGATE },
  P0245: { title: "Turbons styrventil: låg signal", fix: WASTEGATE },
  P0246: { title: "Turbons styrventil: hög signal", fix: WASTEGATE },
  P0033: { title: "Turbons dumpventil", fix: DUMP },
  P0034: { title: "Turbons dumpventil: låg signal", fix: DUMP },
  P0035: { title: "Turbons dumpventil: hög signal", fix: DUMP },
  P2261: { title: "Turbons dumpventil: mekaniskt fel", fix: DUMP },
  P2263: { title: "Turbon ger fel laddtryck", fix: "Laddtrycket blir inte som det ska. Oftast en läckande slang, dumpventilen eller wastegate-ventilen." },
  P2563: { title: "Turbons lägesgivare", fix: "Givaren eller styrmotorn på turbon. Låt en verkstad felsöka." },
  P0045: { title: "Turbons styrning", fix: WASTEGATE },
  P0046: { title: "Turbons styrning", fix: WASTEGATE },
  P0101: { title: "Luftmassemätare", fix: "Luftmassemätaren kan vara smutsig. Den går ofta att rengöra med en särskild spray. Kolla också luftfiltret." },
  P0171: { title: "För lite bränsle i blandningen", fix: "Ofta ett luftläckage, till exempel en sprucken slang, eller en smutsig luftmassemätare." },
  P0300: { title: "Motorn misständer", fix: "Vanligen tändstift eller en tändspole. Kör lugnt och låt en verkstad titta snart." },
  P0401: { title: "EGR-ventil", fix: "EGR-ventilen är ofta igensotad. Den kan rengöras eller bytas." },
  P0420: { title: "Katalysator", fix: "Katalysatorn har blivit sämre, eller så är en lambdasond trasig. Inte akut, men bör kollas före besiktningen." },
};

/** Förklaring för en kod. Okända koder får en allmän text utifrån kodens grupp. */
export function codeInfo(code: string): CodeInfo {
  if (INFO[code]) return INFO[code];
  const g = code.slice(0, 3);
  if (code[0] === "P" && g === "P03") return { title: "Tändning eller misständning", fix: "Ofta tändstift eller tändspole. Låt en verkstad titta." };
  if (code[0] === "P" && (g === "P01" || g === "P02")) return { title: "Luft eller bränsle", fix: "Något med luft- eller bränslesystemet, till exempel en givare eller en slang. Visa koden för verkstaden." };
  if (code[0] === "P" && g === "P04") return { title: "Avgasrening", fix: "Något i avgasreningen. Oftast inte akut, men visa koden för verkstaden." };
  if (code[0] === "P" && g === "P07") return { title: "Växellåda", fix: "Ett fel i växellådan. Låt en verkstad titta." };
  if (code[0] === "U") return { title: "Kommunikation i bilen", fix: "Bilens styrenheter har haft svårt att prata med varandra. Kan vara tillfälligt. Kommer det tillbaka, låt en verkstad titta." };
  return { title: "Ovanlig felkod", fix: "Visa koden för en verkstad, så kan de slå upp vad den betyder för just din bil." };
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
