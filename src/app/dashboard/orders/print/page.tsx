"use client";

import { useEffect, Suspense, useState } from 'react';
import QRCode from 'qrcode';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { getRestaurantProfile, getRestaurantLogo, getBillByOrder, RestaurantProfile, requestBackend } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import Image from 'next/image';

type OrderItem = {
    id: string;
    name: string;
    quantity: number;
    price: number;
    orderedAt: string;
};

type Tax = {
    id: string;
    name: string;
    percentage: number;
    amount: number;
};

type Order = {
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
};

function PrintPageContents() {
    const searchParams = useSearchParams();
    const orderKey = searchParams.get('orderKey');
    const legacyOrderData = searchParams.get('order');
    const { user } = useAuth();
    const [logoBase64, setLogoBase64] = useState<string | null>(null);
    const [bill, setBill] = useState<any | null>(null);
    const [profile, setProfile] = useState<RestaurantProfile | null>(null);
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
        if (!parsed) return;

        // fetch restaurant profile, logo and bill info
        (async () => {
            try {
                const restaurantId = user?.restaurantUsername ?? parsed.res_id ?? null;
                if (restaurantId) {
                        const prof = await getRestaurantProfile(restaurantId, user?.employeeId ?? '').catch(() => null);
                        setProfile(prof ?? null);
                        const logo = await getRestaurantLogo(restaurantId).catch(() => null);
                        setLogoBase64(logo ?? null);
                        const billResp = await getBillByOrder(restaurantId, parsed.id).catch(() => null);
                        setBill(billResp ?? null);

                        // Build feedback URL like settings and generate QR data URL client-side
                        try {
                            const fallbackBase = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:9003` : '';
                            const baseUrl = (process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL ?? fallbackBase).replace(/\/$/, '');
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
    
    // Exact mathematical logic for round-off and grand total
    const rawTotal = Number(order.total);
    const calculatedRoundOff = Math.round(rawTotal) - rawTotal;
    const roundOffVal = order.roundOff !== undefined ? Number(order.roundOff) : calculatedRoundOff;
    const finalGrandTotal = rawTotal + roundOffVal;

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
                <div className="mb-3 text-right">
                    <div className="flex gap-2 justify-end no-print">
                        <button
                            onClick={() => { window.print(); }}
                            className="px-3 py-1 border rounded text-sm"
                        >Print</button>
                        <button
                                onClick={async () => {
                                    // Passed logoBase64 to the encoder
                                    const esc = await generateEscPos(user, profile, cashierName, bill, order, logoBase64);
                                    if (!esc) return;

                                    // Convert ESC/POS > readable text preview
                                    const decoded = new TextDecoder().decode(esc);
                                    setPreviewText(decoded);

                                    // Convert to base64 and send to backend to publish to subscribed printing apps
                                    const toBase64 = (bytes: Uint8Array) => {
                                        if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
                                            let binary = '';
                                            const len = bytes.byteLength;
                                            for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
                                            return window.btoa(binary);
                                        }
                                        // fallback (node)
                                        return Buffer.from(bytes).toString('base64');
                                    };

                                    const b64 = toBase64(esc);
                                    const backend = (process.env.NEXT_PUBLIC_BACKEND_URL ?? `${window.location.protocol}//${window.location.hostname}:3000`).replace(/\/$/, '');

                                    try {
                                        const resp = await requestBackend({
                                            baseUrl: backend,
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
                    <CardDescription className="text-sm">{profile?.outlet_add ?? 'Address not configured'}</CardDescription>
                </CardHeader>
                <CardContent className="p-6">
                    <div className="mb-4 text-sm" > 
                        <div className="w-full">
                            <p><strong>Customer Name:</strong> {order.customer}</p>
                        </div>
                        <div className="border-t border-black pt-2 w-full text-center flex justify-between">
                            <p><strong>Date:</strong> {new Date().toLocaleString()}</p>
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
                        <p>For calling Valet kindly scan the below QR code</p>
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

export async function generateEscPos(user: any, profile: any, cashierName: string, bill: any, orderArg?: any, logoBase64?: string | null): Promise<Uint8Array | null> {
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

            if (!order) return null;
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
        
        if (typeof (encoder as any).initialize === 'function') (encoder as any).initialize();

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
                    if (currentLine) lines.push(currentLine.trim());
                    currentLine = word + ' ';
                } else {
                    currentLine += word + ' ';
                }
            });
            if (currentLine) lines.push(currentLine.trim());

            return lines.length > 0 ? lines : [''];
        };

        const currencySymbol = order.currencySymbol || '₹';

        // ----------------------------------------------------
        // Receipt Generation
        // ----------------------------------------------------
        encoder.align('center');

        // Dynamically process and insert the Logo if available
        if (logoBase64 && typeof window !== 'undefined') {
            try {
                // 1. Load image asynchronously to get true dimensions
                const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                    const i = document.createElement('img') as HTMLImageElement;
                    i.onload = () => resolve(i);
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

        // Header Text
        encoder
            .bold(true)
            .line(profile?.outlet_name ?? 'CSR Organics Main Outlet')
            .bold(false)
            .line(profile?.outlet_add ?? '12 Example Street, Bengaluru')
            .newline()
            .line(lineSeparator)
            .align('left');

        // Meta info
        encoder.line(`Customer Name: ${order.customer || 'Guest'}`);

        encoder.line(lineSeparator);

        const orderDate = new Date().toLocaleString(); 
        encoder.line(leftRight(`Date: ${orderDate}`, `Dine In: ${order.table || 'N/A'}`, MAX_CHARS));
        
        let displayId = bill.bill_no || '';
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
        const rawTotal = Number(order.total);
        const calculatedRoundOff = Math.round(rawTotal) - rawTotal;
        const roundOffVal = order.roundOff !== undefined ? Number(order.roundOff) : calculatedRoundOff;
        const finalGrandTotal = rawTotal + roundOffVal;

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
            .line(lineSeparator)
            .line('For calling Valet kindly scan the below QR code')
            .newline();

        // QR
        const fallbackBase = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:9003` : '';
        const baseUrl = (process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL ?? fallbackBase).replace(/\/$/, '');
        if (baseUrl && user?.res_id && user?.employeeId && user?.outlet_id) {
            const params = new URLSearchParams({ restaurantId: user.res_id, employeeId: user.employeeId, outletId: user.outlet_id });
            const feedbackUrl = `${baseUrl}?${params.toString()}`;
            
            encoder.qrcode(feedbackUrl, 2, 6, 'l');
        }

        encoder.newline().newline();
        encoder.cut();

        return encoder.encode();

    } catch (err) {
        console.error("Error generating ESC/POS sequence:", err);
        return null;
    }
}