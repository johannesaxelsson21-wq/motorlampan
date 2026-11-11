// Kör: node src/obd.test.ts
import { parseDTCs, protocolIsCan, answered0100, clearedOk } from "./obd.ts";
const cases: [string, string, string[], boolean | undefined][] = [
  ["CAN 1 kod", "43010299\r", ["P0299"], true],
  ["CAN utfyllt", "43010299000000\r", ["P0299"], true],
  ["CAN 0 koder", "4300\r", [], true],
  ["CAN flera ramar", "008\r0:430302990234\r1:24360000000000\r", ["P0299", "P0234", "P2436"], true],
  ["CAN mellanslag", "SEARCHING...\r43 02 02 99 C1 23\r", ["P0299", "U0123"], true],
  ["ISO 9141", "43 02 99 01 71 00 00\r43 03 00 00 00 00 00\r", ["P0299", "P0171", "P0300"], false],
  ["ISO okänt prot", "430299017100 00\r", ["P0299", "P0171"], undefined],
  ["CAN okänt prot", "43010299\r", ["P0299"], undefined],
  ["NO DATA", "NO DATA\r", [], true],
  ["2 styrenheter", "43010299\r43010034\r", ["P0299", "P0034"], true],
];
let fail = 0;
for (const [n, r, e, c] of cases) {
  const g = parseDTCs(r, c); const ok = JSON.stringify(g) === JSON.stringify(e);
  if (!ok) fail++; console.log((ok ? "OK   " : "FAIL ") + n + " " + JSON.stringify(g));
}
const chk = (n: string, v: boolean) => { if (!v) fail++; console.log((v ? "OK   " : "FAIL ") + n); };
chk("ATDPN A6 = CAN", protocolIsCan("A6\r") === true);
chk("ATDPN 3 = ej CAN", protocolIsCan("3\r") === false);
chk("0100 svar", answered0100("SEARCHING...\r41 00 BE 3E B8 13\r"));
chk("0100 ingen kontakt", !answered0100("SEARCHING...\rUNABLE TO CONNECT\r"));
chk("04 ok", clearedOk("44\r"));
chk("04 nekad", !clearedOk("7F 04 22\r"));
process.exit(fail);
