"use client";

import { useEffect, Suspense, useState } from 'react';
import QRCode from 'qrcode';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import type { BillPrintSettings, RestaurantProfile} from '@/lib/db';
import { getBillPrintSettings, getRestaurantProfile, getRestaurantLogo, getBillByOrder, getBillForTable, requestBackend } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import Image from 'next/image';
import { DEFAULT_TIMEZONE, formatDateTime } from '@/lib/tz';
import { useTimezone } from '@/lib/use-timezone';

interface OrderItem {
    id: string;
    name: string;
    quantity: number;
    price: number;
    orderedAt: string;
}

interface Tax {
    id: string;
    name: string;
    percentage: number;
    amount: number;
}

interface Order {
  id: string;
  table: string;
  customer: string;
  items: OrderItem[];
  subtotal: number;
  serviceCharge?: number;
  serviceChargePercentage?: number;
  applyServiceCharge?: boolean;
  calculatedTaxes?: Tax[];
  total: number;
  roundOff?: number;
  status: string;
  currencySymbol: string;
}

// --- Printed-bill header identity -------------------------------------------
// ONE resolver, used by both the on-screen bill and the ESC/POS encoder below,
// so the paper and the preview cannot drift apart.
//
// The rule every field obeys: it prints ONLY when the tenant actually has one.
// A restaurant with no GSTIN gets a clean receipt, never a stray "GSTN :" with
// nothing after it, and never a blank line standing in for a field it lacks.
// This mirrors escpos.ts (the backend renderer that drives the thermal agent) —
// the two must agree, because the same bill can be printed through either.
// "null" and "undefined" count as unset. A JS null that has been through a
// template literal, a form field or an older client's JSON body arrives as the
// four-letter STRING, and `GSTN : null` on a tax document reads as a filed
// registration rather than a missing one. Mirrors present() in escpos.ts.
const clean = (v: unknown): string => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined' ? '' : s;
};

// A stored address is one text field owners fill in with real line breaks.
// Honour those as hard breaks and drop blank ones, so a trailing newline never
// prints as a gap.
function addressLines(address: unknown): string[] {
    return clean(address).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

// The header lines under the restaurant name, in reference-receipt order:
// legal entity, address, phone, GST registration. Absent fields contribute
// nothing. The phone is the line that lets a guest ring the restaurant about the
// bill in their hand; every outlet already stores one ("Outlets".outlet_main_ph)
// and neither print path used to carry it.
function billHeaderLines(profile: RestaurantProfile | null, billPrint: BillPrintSettings | null): string[] {
    const lines: string[] = [];
    const legalName = clean(billPrint?.legalName);
    if (legalName) {lines.push(legalName);}
    lines.push(...addressLines(profile?.outlet_add));
    const phone = clean(profile?.outlet_phone);
    if (phone) {lines.push(`Ph : ${phone}`);}
    const gstin = clean(billPrint?.gstin);
    if (gstin) {lines.push(`GSTN : ${gstin}`);}
    return lines;
}

// --- What the guest was actually charged --------------------------------------
// The settled bill's OWN grand total wins over anything computed here.
//
// This page used to derive `Math.round(rawTotal) - rawTotal` and print the
// whole-rupee result, because `order.roundOff` is declared but never populated.
// A bill settled at ₹797.55 therefore printed ₹798.00 — while the backend
// renderer (escpos.ts, which drives the thermal agent) prints `grand_total`
// verbatim. Two print paths disagreeing about real money is worse than either
// rounding rule; the settle layer is the single source of truth, so the round
// off line is now the DIFFERENCE the tenant's own settle applied, not a
// rounding this renderer invented.
function resolveTotals(order: Order, bill: any | null): { rawTotal: number; roundOffVal: number; finalGrandTotal: number } {
    const rawTotal = Number(order.total) || 0;
    const settled = Number(bill?.grand_total);
    if (Number.isFinite(settled) && settled > 0) {
        return { rawTotal, roundOffVal: settled - rawTotal, finalGrandTotal: settled };
    }
    // No settled bill row yet (printing a running bill before payment): fall
    // back to the page's original behaviour rather than inventing a total.
    const calculatedRoundOff = Math.round(rawTotal) - rawTotal;
    const roundOffVal = order.roundOff !== undefined ? Number(order.roundOff) : calculatedRoundOff;
    return { rawTotal, roundOffVal, finalGrandTotal: rawTotal + roundOffVal };
}

// The sentence above the feedback/valet QR: the tenant's own when they have set
// one, otherwise the built-in line the backend hands us. `qrNoteDefault` is
// deliberately not hardcoded here — the backend owns that string (escpos.ts
// DEFAULT_BILL_QR_NOTE) and is the single place it is written down.
function billQrNote(billPrint: BillPrintSettings | null): string {
    const own = clean(billPrint?.qrNote);
    if (own) {return billPrint?.qrNoteMax ? own.slice(0, billPrint.qrNoteMax) : own;}
    return clean(billPrint?.qrNoteDefault);
}

function PrintPageContents() {
    // A bill handed to a guest must carry the restaurant's clock, not the
    // clock of whatever machine happens to be driving the printer.
    const { timezone } = useTimezone();
    const searchParams = useSearchParams();
    const orderKey = searchParams.get('orderKey');
    const legacyOrderData = searchParams.get('order');
    const { user } = useAuth();
    const [logoBase64, setLogoBase64] = useState<string | null>(null);
    const [bill, setBill] = useState<any | null>(null);
    const [profile, setProfile] = useState<RestaurantProfile | null>(null);
    const [billPrint, setBillPrint] = useState<BillPrintSettings | null>(null);
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
    const [previewText, setPreviewText] = useState<string | null>(null);
    const [order, setOrder] = useState<Order | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
        const resolveOrder = () => {
            const payload = legacyOrderData ?? (orderKey ? localStorage.getItem(orderKey) : null);
            if (!payload) {
                setLoadError('No order data provided.');
                return null;
            }

            try {
                const parsed = JSON.parse(decodeURIComponent(payload));
                setOrder(parsed);
                return parsed;
            } catch {
                setLoadError('Unable to load order data.');
                return null;
            }
        };

        const parsed = resolveOrder();
        if (!parsed) {return;}

        // fetch restaurant profile, logo and bill info
        (async () => {
            try {
                const restaurantId = user?.restaurantUsername ?? parsed.res_id ?? null;
                if (restaurantId) {
                        const prof = await getRestaurantProfile(restaurantId, user?.employeeId ?? '').catch(() => null);
                        setProfile(prof ?? null);
                        const logo = await getRestaurantLogo(restaurantId).catch(() => null);
                        setLogoBase64(logo ?? null);
                        // Legal entity / GSTIN / the tenant's QR sentence. A
                        // failure here must not stop the bill printing — the
                        // header simply falls back to name + address, which is
                        // what every bill carried before these fields existed.
                        const printSettings = await getBillPrintSettings(restaurantId).catch(() => null);
                        setBillPrint(printSettings ?? null);
                        const billResp = await getBillByOrder(restaurantId, parsed.id).catch(() => null);
                        setBill(billResp ?? null);

                        // Build feedback URL like settings and generate QR data URL client-side
                        // (the form lives inside this app at /feedback; env still overrides).
                        try {
                            const fallbackBase = typeof window !== 'undefined' ? `${window.location.origin}/feedback` : '';
                            // `||`, not `??`: the Dockerfile declares ARG NEXT_PUBLIC_FEEDBACK_FORM_URL
            // with no default, so ENV bakes it as "" — and "" is not null, so `??`
            // never reached the fallback. baseUrl became "", the guard below went
            // falsy, and the feedback QR was silently dropped from every printed
            // bill while the line telling the guest to scan it still printed.
            const baseUrl = (process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL || fallbackBase).replace(/\/$/, '');
                            if (baseUrl && user?.res_id && user?.employeeId && user?.outlet_id) {
                                const params = new URLSearchParams({ restaurantId: user.res_id, employeeId: user.employeeId, outletId: user.outlet_id });
                                const feedbackUrl = `${baseUrl}?${params.toString()}`;
                                const dataUrl = await QRCode.toDataURL(feedbackUrl, { width: 260, margin: 1 });
                                setQrDataUrl(dataUrl);
                            }
                        } catch (err) {
                            // ignore QR generation errors
                        }
                }
            } catch (err) {
                // ignore
            }
            // Do not auto-print. Let the user manually click Print.
        })();
    }, [legacyOrderData, orderKey, user]);

    if (loadError) {
        return (
            <div className="flex items-center justify-center h-screen">
                <p>{loadError}</p>
            </div>
        );
    }

    if (!order) {
        return (
            <div className="flex items-center justify-center h-screen">
                <p>Loading order data...</p>
            </div>
        );
    }
    
    const currencySymbol = order.currencySymbol || '₹';
    const cashierName = `${user?.emp_Fname ?? ''}${user?.emp_Lname ? ` ${user.emp_Lname}` : ''}`.trim() || '';
    const billId = bill?.id ?? '';
    const billNo = bill?.bill_no ?? '';
    const totalQty = order.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
    
    // The settled bill's own total wins — see resolveTotals.
    const { rawTotal, roundOffVal, finalGrandTotal } = resolveTotals(order, bill);

    return (
        <div className="p-4 bg-white text-black">
            <style>{`
                @media print {
                    .no-print, header, footer, nav, .app-header, .app-footer, .dashboard-buttons, .bottom-buttons, .site-footer, .page-footer, .dock, .dock-panel, .dock-container, .dock-wrapper, .dockbar, .site-dock, .app-dock, .bottom-dock, [data-dock], [data-no-print], [class*="dock"] {
                        display: none !important;
                    }
                    /* Ensure the receipt card and its contents print clearly */
                    .receipt-card {
                        display: block !important;
                        visibility: visible !important;
                    }
                }
            `}</style>
            
            <Card className="mx-auto w-[420px] max-w-full shadow-none border-black receipt-card">
                <div className="mb-3 no-print">
                    <p className="mb-2 text-left text-xs text-gray-500">Bill preview — review the receipt below, then click Print when you&apos;re ready. Nothing prints automatically.</p>
                    <div className="flex gap-2 justify-end">
                        <button
                            onClick={() => { window.print(); }}
                            className="px-3 py-1 border rounded text-sm"
                        >Print</button>
                        <button
                            onClick={() => { window.close(); }}
                            className="px-3 py-1 border rounded text-sm"
                        >Close</button>
                        <button
                                onClick={async () => {
                                    // Passed logoBase64 to the encoder
                                    const esc = await generateEscPos(user, profile, cashierName, bill, order, logoBase64, timezone, billPrint);
                                    if (!esc) {return;}

                                    // Convert ESC/POS > readable text preview
                                    const decoded = new TextDecoder().decode(esc);
                                    setPreviewText(decoded);

                                    // Convert to base64 and send to backend to publish to subscribed printing apps
                                    const toBase64 = (bytes: Uint8Array) => {
                                        if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
                                            let binary = '';
                                            const len = bytes.byteLength;
                                            for (let i = 0; i < len; i++) {binary += String.fromCharCode(bytes[i]);}
                                            return window.btoa(binary);
                                        }
                                        // fallback (node)
                                        return Buffer.from(bytes).toString('base64');
                                    };

                                    const b64 = toBase64(esc);
                                    // No baseUrl: requestBackend is a Server Action (lib/db.ts is
                                    // "use server"), so this fetch runs in the Next container and
                                    // resolves the internal backend address itself. The old line
                                    // read the env var with `??`, which does not fall back on an
                                    // empty string, so a production build sent the server a bare
                                    // path — and its window-derived fallback pointed at port 3000,
                                    // the dashboard's own port rather than the backend's 3001.

                                    try {
                                        const resp = await requestBackend({
                                            path: '/publish/bill',
                                            method: 'POST',
                                            body: { restaurantId: user?.res_id, outletId: user?.outlet_id, billId: billId || String(Date.now()), escBase64: b64 },
                                        });

                                        if (!resp.ok) {
                                            alert('Failed to publish bill: ' + resp.text);
                                            return;
                                        }

                                        alert('Bill published to backend for printing');
                                    } catch (err) {
                                        console.error(err);
                                        alert('Unable to send bill to backend');
                                    }
                                }}
                            className="px-3 py-1 border rounded text-sm"
                        >
                            Print ESC/POS
                        </button>
                    </div>
                </div>
                <CardHeader className="text-center border-b border-black pb-4">
                    {logoBase64 ? (
                        <Image src={`data:image/png;base64,${logoBase64}`} alt="logo" className="mx-auto h-16 object-contain" width={64} height={64} />
                    ) : (
                        <p> Loading Logo ... </p>
                    )}
                    <CardTitle className="text-2xl font-bold">{profile?.outlet_name ?? 'Not found'}</CardTitle>
                    {/* Legal entity, address lines, GSTIN — each rendered only
                        when the tenant has one, so a restaurant without them
                        gets a clean receipt instead of empty labels. */}
                    <CardDescription className="text-sm">
                        {billHeaderLines(profile, billPrint).map((l, i) => (
                            <span key={i} className="block">{l}</span>
                        ))}
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-6">
                    <div className="mb-4 text-sm" > 
                        <div className="w-full">
                            <p><strong>Customer Name:</strong> {order.customer}</p>
                        </div>
                        <div className="border-t border-black pt-2 w-full text-center flex justify-between">
                            <p><strong>Date:</strong> {formatDateTime(Date.now(), timezone)}</p>
                            <p><strong>Dine In:</strong> {order.table}</p>
                           
                        </div>
                        <div className="w-full flex justify-between">
                             <p><strong>Bill No.:</strong> {billNo}</p>
                            <p><strong>Cashier:</strong> {cashierName}</p>
                        </div>
                    </div>
                    <Table className="border-t border-black">
                        <TableHeader>
                            <TableRow className="border-b border-black">
                                <TableHead className="text-black">Item</TableHead>
                                <TableHead className="text-black text-center">Qty</TableHead>
                                <TableHead className="text-black text-right">Price</TableHead>
                                <TableHead className="text-black text-right">Total</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {order.items.map(item => (
                                <TableRow key={item.id}>
                                    <TableCell className="font-medium">{item.name}</TableCell>
                                    <TableCell className="text-center">{item.quantity}</TableCell>
                                    <TableCell className="text-right">{item.price.toFixed(2)}</TableCell>
                                    <TableCell className="text-right">{(item.price * item.quantity).toFixed(2)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    <div className="mt-6 space-y-2 text-sm ml-auto max-w-xs ">
                        <div className="flex justify-between border-t border-black pt-2">
                            <span>Subtotal</span>
                            <span>{order.subtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Total Qty</span>
                            <span>{totalQty}</span>
                        </div>
                        {order.serviceChargePercentage && (
                            <div className="flex justify-between">
                                <span>Service Charge ({order.serviceChargePercentage}%)</span>
                                <span>{order.applyServiceCharge ? order.serviceCharge?.toFixed(2) : 'Opted-out'}</span>
                            </div>
                        )}
                        {order.calculatedTaxes?.map(tax => (
                             <div key={tax.id} className="flex justify-between">
                                <span>{tax.name} ({tax.percentage}%)</span>
                                <span>{tax.amount.toFixed(2)}</span>
                            </div>
                        ))}

                        <hr className="border-t border-black my-2" />

                        {/* Round off displayed BEFORE Grand Total */}
                        <div className="flex justify-between text-sm mt-1">
                            <span>Round off</span>
                            <span>{(roundOffVal > 0 ? '+' : '') + roundOffVal.toFixed(2)}</span>
                        </div>
                        
                        {/* Grand Total reflects raw total + round off */}
                        <div className="flex justify-between font-bold text-lg pt-2 mt-2">
                            <span>Grand Total:</span>
                            <span>{currencySymbol}{finalGrandTotal.toFixed(2)}</span>
                        </div>
                    </div>
                    <hr className="border-t border-black my-4" />
                     <div className="text-center mt-2 text-xs text-gray-600">
                        <p>Thanks</p>
                    </div>

                    <div className="text-center mt-4 text-xs text-gray-600">
                        {/* The tenant's own sentence when they have set one;
                            otherwise the built-in line the backend supplies.
                            Omitted rather than rendered blank if neither is
                            available (i.e. the settings fetch failed). */}
                        {billQrNote(billPrint) ? <p>{billQrNote(billPrint)}</p> : null}
                                                {qrDataUrl ? (
                                                    <Image src={qrDataUrl} alt="valet-qr" className="mx-auto mt-2 w-[150px] h-[150px]" width={150} height={150} />
                                                ) : (
                          <p className="text-xs text-muted-foreground">Loading QR...</p>
                        )}
                    </div>
                </CardContent>
            </Card>
            {previewText && (
                <div className="mt-6 p-4 border bg-gray-100 text-xs whitespace-pre overflow-x-auto">
                    <h3 className="font-bold mb-2">ESC/POS Preview:</h3>
                    <pre className="font-mono min-w-max">{previewText}</pre>
                </div>
            )}
        </div>
    );
}

export default function PrintPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <PrintPageContents />
        </Suspense>
    );
}

export async function generateEscPos(user: any, profile: any, cashierName: string, bill: any, orderArg?: any, logoBase64?: string | null, timeZone: string = DEFAULT_TIMEZONE, billPrint: BillPrintSettings | null = null): Promise<Uint8Array | null> {
    try {
        let order = orderArg ?? null;

        if (!order) {
            const searchParams = new URLSearchParams(window.location.search);
            const orderData = searchParams.get('order');
            const orderKey = searchParams.get('orderKey');

            if (orderData) {
                try {
                    order = JSON.parse(decodeURIComponent(orderData));
                } catch (e) {
                    console.error('Failed to parse order from query param', e);
                    order = null;
                }
            }

            if (!order && orderKey && typeof window !== 'undefined') {
                try {
                    const payload = window.localStorage.getItem(orderKey);
                    if (payload) {
                        order = JSON.parse(decodeURIComponent(payload));
                    }
                } catch (e) {
                    console.error('Failed to parse order from localStorage', e);
                    order = null;
                }
            }

            if (!order) {return null;}
        }

        const pkg = await import('@point-of-sale/receipt-printer-encoder');
        const EncoderClass = pkg?.default ?? pkg?.ReceiptPrinterEncoder ?? pkg;
        if (typeof EncoderClass !== 'function') {
            console.error('ReceiptPrinterEncoder is not a constructor', EncoderClass);
            return null;
        }

        const encoder = new EncoderClass({ 
            language: 'esc-pos', 
            width: 48, 
            columns: 48,
            feedBeforeCut: 4, 
        });
        
        if (typeof (encoder).initialize === 'function') {(encoder).initialize();}

        // ----------------------------------------------------
        // Layout Config & Helpers
        // ----------------------------------------------------
        const MAX_CHARS = 48; // Standard width for 80mm printers
        const lineSeparator = '-'.repeat(MAX_CHARS);

        const leftRight = (left: string, right: string, width = MAX_CHARS) => {
            const l = left.toString();
            const r = right.toString();
            if (l.length + r.length >= width) {
                const availableForLeft = width - r.length - 1;
                return l.substring(0, availableForLeft > 0 ? availableForLeft : 0) + ' ' + r;
            }
            return l + ' '.repeat(width - l.length - r.length) + r;
        };

        const wrapText = (text: string, maxLen: number): string[] => {
            const words = (text || '').split(' ');
            const lines: string[] = [];
            let currentLine = '';

            words.forEach(word => {
                if ((currentLine + word).length > maxLen) {
                    if (currentLine) {lines.push(currentLine.trim());}
                    currentLine = word + ' ';
                } else {
                    currentLine += word + ' ';
                }
            });
            if (currentLine) {lines.push(currentLine.trim());}

            return lines.length > 0 ? lines : [''];
        };

        const currencySymbol = 'Rs. '; //order.currencySymbol || '₹';

        // ----------------------------------------------------
        // Receipt Generation
        // ----------------------------------------------------
        encoder.align('center');

        // Dynamically process and insert the Logo if available
        if (logoBase64 && typeof window !== 'undefined') {
            try {
                // 1. Load image asynchronously to get true dimensions
                const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                    const i = document.createElement('img');
                    i.onload = () => { resolve(i); };
                    i.onerror = reject;
                    i.src = `data:image/png;base64,${logoBase64}`;
                });

                // 2. Calculate aspect ratio boundaries
                // Full 80mm printer width is 512 dots. We use 384 for a clean centered logo.
                const MAX_LOGO_WIDTH = 384; 
                let targetWidth = Math.min(img.width, MAX_LOGO_WIDTH);
                
                // 3. Round down to nearest multiple of 8 (Mandatory for ESC/POS bit-image processing)
                targetWidth = Math.floor(targetWidth / 8) * 8;
                
                // 4. Calculate height maintaining aspect ratio
                const targetHeight = Math.round((img.height / img.width) * targetWidth);

                // 5. Draw to off-screen canvas to flatten transparencies
                const canvas = document.createElement('canvas');
                canvas.width = targetWidth;
                canvas.height = targetHeight;
                const ctx = canvas.getContext('2d');
                
                if (ctx) {
                    // Fill white background first (prevent transparent PNGs printing black)
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(0, 0, targetWidth, targetHeight);
                    // Draw resized logo
                    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

                    // 6. Push canvas to encoder using threshold (best for vector logos)
                    encoder.image(canvas, targetWidth, targetHeight, 'threshold');
                    encoder.newline();
                }
            } catch (err) {
                console.error("Failed to render logo to ESC/POS", err);
            }
        }

        // Header Text — name, then legal entity / address lines / GSTIN.
        // Each of those prints ONLY when the tenant has one (billHeaderLines
        // drops the rest), so a restaurant with no GSTIN or no registered
        // entity gets a clean receipt rather than orphan labels.
        encoder
            .bold(true)
            .line(profile?.outlet_name ?? 'CSR Organics Main Outlet')
            .bold(false);

        for (const headerLine of billHeaderLines(profile, billPrint)) {
            encoder.line(headerLine);
        }

        encoder
            .newline()
            .line(lineSeparator)
            .align('left');

        // Meta info
        encoder.line(`Customer Name: ${order.customer || 'Guest'}`);

        encoder.line(lineSeparator);

        const orderDate = formatDateTime(Date.now(), timeZone); 
        encoder.line(leftRight(`Date: ${orderDate}`, `Dine In: ${order.table || 'N/A'}`, MAX_CHARS));
        
        const displayId = bill.bill_no || '';
        // if (displayId.length > 18) {
        //     const parts = displayId.split('-');
        //     displayId = parts.length > 1 ? `${parts[0]}-${parts[1].substring(0, 1)}` : displayId.substring(0, 10);
        // }

        encoder.line(leftRight(`Bill No.: ${displayId}`, `Cashier: ${cashierName}`, MAX_CHARS));
        encoder.line(lineSeparator);

        // Items Header 
        const COL_ITEM = 20;
        const COL_QTY = 6;
        const COL_PRICE = 10;
        const COL_TOTAL = 12;

        encoder.line('Item'.padEnd(COL_ITEM) + 'Qty'.padStart(COL_QTY) + 'Price'.padStart(COL_PRICE) + 'Total'.padStart(COL_TOTAL));
        encoder.line(lineSeparator);

        // Items List
        order.items.forEach((it: any) => {
            const itemNameLines = wrapText(it.name, COL_ITEM - 1);
            const qtyStr = String(it.quantity).padStart(COL_QTY);
            const priceStr = Number(it.price).toFixed(2).padStart(COL_PRICE);
            const totalStr = (Number(it.price) * Number(it.quantity)).toFixed(2).padStart(COL_TOTAL);

            encoder.line(itemNameLines[0].padEnd(COL_ITEM) + qtyStr + priceStr + totalStr);

            for (let i = 1; i < itemNameLines.length; i++) {
                encoder.line(itemNameLines[i]);
            }
            
            encoder.newline();
        });

        encoder.line(lineSeparator);

        // Totals
        const totalQty = order.items.reduce((s: number, it: any) => s + Number(it.quantity), 0);

        encoder.line(leftRight('Subtotal', Number(order.subtotal).toFixed(2)));
        encoder.line(leftRight('Total Qty', String(totalQty)));

        if (order.serviceChargePercentage) {
            const scAmount = order.applyServiceCharge ? Number(order.serviceCharge) : 0;
            encoder.line(leftRight(`Service Charge (${order.serviceChargePercentage}%)`, order.applyServiceCharge ? scAmount.toFixed(2) : 'Opted-out'));
        }

        if (order.calculatedTaxes) {
            order.calculatedTaxes.forEach((t: any) => {
                encoder.line(leftRight(`${t.name} (${t.percentage}%)`, Number(t.amount).toFixed(2)));
            });
        }

        // Exact mathematical logic for round-off and grand total
        const { rawTotal, roundOffVal, finalGrandTotal } = resolveTotals(order, bill);

        // Round off FIRST
        const roundOffDisplay = (roundOffVal > 0 ? '+' : '') + roundOffVal.toFixed(2);
        
        encoder.line(lineSeparator);
        encoder.line(leftRight('Round off', roundOffDisplay));

        // Grand Total LAST
        encoder
            .bold(true)
            .line(leftRight('Grand Total:', currencySymbol + finalGrandTotal.toFixed(2)))
            .bold(false);
            
        encoder.line(lineSeparator);

        // Footer
        encoder
            .align('center')
            .line('Thanks')
            .line(lineSeparator);

        // The tenant's own sentence above the QR when they have set one,
        // otherwise the built-in valet line. Wrapped to the paper width so a
        // long message stays inside the column instead of being clipped.
        //
        // Guarded on non-empty: wrapText('') yields [''], which would feed the
        // encoder a blank line where the sentence should be. That only happens
        // if the settings fetch failed AND the tenant set no note of their own.
        const qrNoteText = billQrNote(billPrint);
        if (qrNoteText) {
            for (const noteLine of wrapText(qrNoteText, MAX_CHARS)) {
                encoder.line(noteLine);
            }
        }
        encoder.newline();

        // QR (feedback form lives inside this app at /feedback; env still overrides)
        const fallbackBase = typeof window !== 'undefined' ? `${window.location.origin}/feedback` : '';
        // `||`, not `??` — see the same guard above: the env bakes as "" and `??`
        // never fires on it, which dropped the feedback QR from the printed bill.
        const baseUrl = (process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL || fallbackBase).replace(/\/$/, '');
        if (baseUrl && user?.res_id && user?.employeeId && user?.outlet_id) {
            const params = new URLSearchParams({ restaurantId: user.res_id, employeeId: user.employeeId, outletId: user.outlet_id });
            const feedbackUrl = `${baseUrl}?${params.toString()}`;
            
            encoder.qrcode(feedbackUrl, 2, 6, 'l');
        }

        encoder.align('center').line('A Voluntary Service Charge is included to support our staff. If you prefer not to contribute, please inform your server before payment and it will be removed.');
        encoder.cut();

        return encoder.encode();

    } catch (err) {
        console.error("Error generating ESC/POS sequence:", err);
        return null;
    }
}