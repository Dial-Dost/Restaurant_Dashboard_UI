// A TEST-SIDE READER FOR AN ESC/POS BILL — deliberately not the one the print
// page uses (billEscPosPreviewText), so a bug in that preview cannot hide the
// same bug in the bytes.
//
// WHY RASTERS ARE STEPPED OVER BY LENGTH. The bill's rules are GS v 0 images,
// and the header byte yL of a thin rule is 10 — the same byte as "\n". A naive
// latin1 decode split on newlines cuts every thin rule in two and reports
// garbage lines. So each GS v 0 block is skipped by its own header
// (8 + widthBytes * height bytes) and replaced by ONE marker line:
//
//   <RULE>        a solid rule with 2 rows of ink (billRule thin)
//   <RULE:THICK>  a solid rule with 4 rows of ink (billRule thick)
//   <IMAGE>       any other raster (the logo)
//   <QR>          a GS ( k QR block
//
// Every other command this bill emits (ESC @, ESC a, ESC E, ESC !, GS L, GS W,
// GS V) is dropped, leaving the printed text.

/**
 * Is this GS v 0 body a billRule? Returns its ink-row count, or 0 if not. The
 * shape is exact: 4 blank rows, then solid rows (every byte full, bar a partial
 * last byte), then 4 blank rows — so a logo that happens to be dark is not
 * mistaken for a rule.
 */
function ruleInk(body: Uint8Array, widthBytes: number, height: number): number {
    const ink = height - 8;
    if (ink !== 2 && ink !== 4) { return 0; }
    for (let y = 0; y < height; y++) {
        const row = body.subarray(y * widthBytes, (y + 1) * widthBytes);
        const solid = y >= 4 && y < 4 + ink;
        const ok = solid
            ? row.subarray(0, widthBytes - 1).every((v) => v === 0xff) && (row[widthBytes - 1] ?? 0) !== 0
            : row.every((v) => v === 0);
        if (!ok) { return 0; }
    }
    return ink;
}

/** The bill's printed lines, with markers in place of rasters and the QR. */
export function escposLines(bytes: Uint8Array): string[] {
    let text = '';
    let i = 0;
    const newlineMarker = (m: string): void => {
        if (text !== '' && !text.endsWith('\n')) { text += '\n'; }
        text += `${m}\n`;
    };
    while (i < bytes.length) {
        const b = bytes[i] ?? 0;
        const n1 = bytes[i + 1];
        if (b === 0x1b) {
            i += n1 === 0x40 ? 2 : 3;
            continue;
        }
        if (b === 0x1d) {
            if (n1 === 0x4c || n1 === 0x57) { i += 4; continue; }
            if (n1 === 0x76 && bytes[i + 2] === 0x30) {
                const widthBytes = (bytes[i + 4] ?? 0) | ((bytes[i + 5] ?? 0) << 8);
                const height = (bytes[i + 6] ?? 0) | ((bytes[i + 7] ?? 0) << 8);
                const body = bytes.subarray(i + 8, i + 8 + widthBytes * height);
                const ink = ruleInk(body, widthBytes, height);
                newlineMarker(ink === 2 ? '<RULE>' : ink === 4 ? '<RULE:THICK>' : '<IMAGE>');
                i += 8 + widthBytes * height;
                continue;
            }
            if (n1 === 0x28 && bytes[i + 2] === 0x6b) {
                const len = (bytes[i + 3] ?? 0) | ((bytes[i + 4] ?? 0) << 8);
                if (bytes[i + 6] === 0x51) { newlineMarker('<QR>'); }
                i += 5 + len;
                continue;
            }
            i += 3; // GS V n
            continue;
        }
        text += String.fromCharCode(b);
        i++;
    }
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') { lines.pop(); }
    return lines;
}

/** The raw stream as latin1, for asserting command bytes around a run of text. */
export const latin1 = (bytes: Uint8Array): string => Array.from(bytes, (b) => String.fromCharCode(b)).join('');
