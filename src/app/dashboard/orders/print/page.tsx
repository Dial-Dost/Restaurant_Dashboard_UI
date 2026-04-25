
"use client";

import { useEffect, Suspense, useState } from 'react';
import QRCode from 'qrcode';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { getRestaurantProfile, getRestaurantLogo, getBillByOrder, RestaurantProfile } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// Dynamically import the encoder inside the function to avoid bundler/constructor issues

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
  status: string;
  currencySymbol: string;
};

function PrintPageContents() {
    const searchParams = useSearchParams();
    const orderData = searchParams.get('order');
    const { user } = useAuth();
    const [logoBase64, setLogoBase64] = useState<string | null>(null);
    const [bill, setBill] = useState<any | null>(null);
    const [profile, setProfile] = useState<RestaurantProfile | null>(null);
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
    const [previewText, setPreviewText] = useState<string | null>(null);

    useEffect(() => {
        if (!orderData) return;
        // fetch restaurant profile, logo and bill info
        (async () => {
            try {
                const parsed = JSON.parse(decodeURIComponent(orderData));
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
    }, [orderData]);

    if (!orderData) {
        return (
            <div className="flex items-center justify-center h-screen">
                <p>No order data provided. This window will close automatically.</p>
            </div>
        );
    }
    
    const order: Order = JSON.parse(decodeURIComponent(orderData));
    const currencySymbol = order.currencySymbol || '$';
    const cashierName = `${user?.emp_Fname ?? ''}${user?.emp_Lname ? ` ${user.emp_Lname}` : ''}`.trim() || '';
    const billNo = bill?.id ?? '';
    const totalQty = order.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
    const roundOff = Math.round(order.total) - order.total;

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
                                const esc = await generateEscPos(user, profile, cashierName);
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
                                    const resp = await fetch(`${backend}/publish/bill`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ restaurantId: user?.res_id, outletId: user?.outlet_id, billId: billNo || String(Date.now()), escBase64: b64 }),
                                    });

                                    if (!resp.ok) {
                                        const txt = await resp.text();
                                        alert('Failed to publish bill: ' + txt);
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
                            Preview ESC/POS
                        </button>
                    </div>
                </div>
                <CardHeader className="text-center border-b border-black pb-4">
                    {logoBase64 ? (
                        <img src={`data:image/png;base64,${logoBase64}`} alt="logo" className="mx-auto h-16 object-contain" />
                    ) : (
                        <p> Logo Not Found </p>
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
                             <p><strong>Bill No.:</strong> {billNo.slice(0, 10) || order.id}</p>
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
                                    <TableCell className="text-right">{currencySymbol}{item.price.toFixed(2)}</TableCell>
                                    <TableCell className="text-right">{currencySymbol}{(item.price * item.quantity).toFixed(2)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    <div className="mt-6 space-y-2 text-sm ml-auto max-w-xs ">
                        <div className="flex justify-between border-t border-black pt-2">
                            <span>Subtotal</span>
                            <span>{currencySymbol}{order.subtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Total Qty</span>
                            <span>{totalQty}</span>
                        </div>
                        {order.serviceChargePercentage && (
                            <div className="flex justify-between">
                                <span>Service Charge ({order.serviceChargePercentage}%)</span>
                                <span>{order.applyServiceCharge ? `${currencySymbol}${order.serviceCharge?.toFixed(2)}` : 'Opted-out'}</span>
                            </div>
                        )}
                        {order.calculatedTaxes?.map(tax => (
                             <div key={tax.id} className="flex justify-between">
                                <span>{tax.name} ({tax.percentage}%)</span>
                                <span>{currencySymbol}{tax.amount.toFixed(2)}</span>
                            </div>
                        ))}
                        <hr className="border-t border-black my-2" />
                        <div className="flex justify-between font-bold text-lg pt-2 mt-2">
                            <span>Grand Total:</span>
                            <span>{currencySymbol}{order.total.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm mt-1">
                            <span>Round off</span>
                            <span>{currencySymbol}{roundOff.toFixed(2)}</span>
                        </div>
                    </div>
                    <hr className="border-t border-black my-4" />
                     <div className="text-center mt-2 text-xs text-gray-600">
                        <p>Thanks</p>
                    </div>

                    <div className="text-center mt-4 text-xs text-gray-600">
                        <p>For calling Valet kindly scan the below QR code</p>
                        {qrDataUrl ? (
                          <img src={qrDataUrl} alt="valet-qr" className="mx-auto mt-2 w-[150px] h-[150px]" />
                        ) : (
                          <p className="text-xs text-muted-foreground">Loading QR...</p>
                        )}
                    </div>
                </CardContent>
            </Card>
            {previewText && (
                <div className="mt-6 p-4 border bg-gray-100 text-xs whitespace-pre-wrap">
                    <h3 className="font-bold mb-2">ESC/POS Preview:</h3>
                    <pre>{previewText}</pre>
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


async function generateEscPos(user: any, profile: RestaurantProfile | null, cashierName: string): Promise<Uint8Array | null> {
    try {
        const searchParams = new URLSearchParams(window.location.search);
        const orderData = searchParams.get('order');
        if (!orderData) return null;

        const order = JSON.parse(decodeURIComponent(orderData));

        // dynamically import the package and resolve the constructor across CJS/ESM shapes
        const pkg = await import('@point-of-sale/receipt-printer-encoder');
        const EncoderClass = pkg?.default ?? pkg?.ReceiptPrinterEncoder ?? pkg;
        if (typeof EncoderClass !== 'function') {
            console.error('ReceiptPrinterEncoder is not a constructor', EncoderClass);
            return null;
        }

        const encoder = new EncoderClass({ language: 'esc-pos' });
        // some builds expose initialize as optional
        if (typeof (encoder as any).initialize === 'function') (encoder as any).initialize();

        // Header
        encoder
            .align('center')
            .bold(true)
            .line(profile?.outlet_name ?? 'CuisineFlow')
            .bold(false)
            .line(profile?.outlet_add ?? '')
            .newline();

        // Meta info
        encoder
            .align('left')
            .line(`Customer: ${order.customer}`)
            .line(`Bill No: ${order.id}`)
            .line(`Table: ${order.table}`)
            .line(`Date: ${new Date().toLocaleString()}`)
            .line(`Cashier: ${cashierName}`)
            .newline();

        // Items
        encoder.line('Item           Qty   Price   Amt');
        encoder.line('--------------------------------');

        order.items.forEach((it: any) => {
            const name = it.name.slice(0, 14).padEnd(14);
            const qty = String(it.quantity).padStart(3);
            const price = it.price.toFixed(2).padStart(7);
            const amt = (it.price * it.quantity).toFixed(2).padStart(7);

            encoder.line(`${name}${qty}${price}${amt}`);
        });

        encoder.newline();

        // Totals
        const totalQty = order.items.reduce((s: number, it: any) => s + it.quantity, 0);

        encoder
            .line(`Total Qty: ${totalQty}`)
            .line(`Subtotal: ${order.subtotal.toFixed(2)}`);

        if (order.calculatedTaxes) {
            order.calculatedTaxes.forEach((t: any) => {
                encoder.line(`${t.name} (${t.percentage}%): ${t.amount.toFixed(2)}`);
            });
        }

        encoder
            .newline()
            .bold(true)
            .align('right')
            .line(`TOTAL: ${order.total.toFixed(2)}`)
            .bold(false)
            .align('center')
            .newline()
            .line('Thank you!')
            .newline()
            .line('For calling Valet kindly scan the below QR code')
            .newline();

        // QR
        const fallbackBase = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:9003` : '';
        const baseUrl = (process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL ?? fallbackBase).replace(/\/$/, '');
        if (baseUrl && user?.res_id && user?.employeeId && user?.outlet_id) {
            const params = new URLSearchParams({ restaurantId: user.res_id, employeeId: user.employeeId, outletId: user.outlet_id });
            const feedbackUrl = `${baseUrl}?${params.toString()}`;
            encoder.qrcode(feedbackUrl, 6, 'L');
        }

        encoder.newline().newline();

        // Cut
        encoder.cut();

        return encoder.encode();

    } catch (err) {
        console.error(err);
        return null;
    }
}