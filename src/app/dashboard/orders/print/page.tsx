
"use client";

import { useEffect, Suspense, useState } from 'react';
import QRCode from 'qrcode';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { getRestaurantProfile, getRestaurantLogo, getBillByOrder } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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
    const [profile, setProfile] = useState<any | null>(null);
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

    useEffect(() => {
        if (!orderData) return;
        // fetch restaurant profile, logo and bill info
        (async () => {
            try {
                                const parsed = JSON.parse(decodeURIComponent(orderData));
                                const restaurantId = user?.restaurantId ?? parsed.res_id ?? null;
                                if (restaurantId) {
                                        const prof = await getRestaurantProfile(restaurantId).catch(() => null);
                                        setProfile(prof ?? null);
                                        const logo = await getRestaurantLogo(restaurantId).catch(() => null);
                                        setLogoBase64(logo ?? null);
                                        const billResp = await getBillByOrder(restaurantId, parsed.id).catch(() => null);
                                        setBill(billResp ?? null);

                                        // Build feedback URL like settings and generate QR data URL client-side
                                        try {
                                            const fallbackBase = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:9003` : '';
                                            const baseUrl = (process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL ?? fallbackBase).replace(/\/$/, '');
                                            if (baseUrl && user?.restaurantId && user?.employeeId) {
                                                const params = new URLSearchParams({ restaurantId: user.restaurantId, employeeId: user.employeeId });
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
            
            <Card className="mx-auto shadow-none border-black receipt-card" style={{width: 420}}>
                <div className="mb-3 text-right">
                                                <div className="flex gap-2 justify-end no-print">
                                                    <button
                                                        onClick={() => { window.print(); }}
                                                        className="px-3 py-1 border rounded text-sm"
                                                    >Print</button>
                                                    {/* <button
                                                        onClick={async () => {
                                                            const esc = await generateEscPos();
                                                            if (!esc) return;
                                                            const blob = new Blob([esc], { type: 'application/octet-stream' });
                                                            const url = URL.createObjectURL(blob);
                                                            const a = document.createElement('a');
                                                            a.href = url;
                                                            a.download = `bill-${billNo || order.id}.bin`;
                                                            document.body.appendChild(a);
                                                            a.click();
                                                            a.remove();
                                                            URL.revokeObjectURL(url);
                                                        }}
                                                        className="px-3 py-1 border rounded text-sm"
                                                    >Download ESC/POS</button> */}
                                                </div>
                </div>
                <CardHeader className="text-center border-b border-black pb-4">
                    {logoBase64 ? (
                        <img src={`data:image/png;base64,${logoBase64}`} alt="logo" className="mx-auto h-16 object-contain" />
                    ) : (
                        <CardTitle className="text-2xl font-bold">{profile?.outlet_name ?? profile?.res_name ?? 'CuisineFlow'}</CardTitle>
                    )}
                    <CardDescription className="text-sm">{profile?.outlet_add ?? profile?.res_address ?? 'Address not configured'}</CardDescription>
                </CardHeader>
                <CardContent className="p-6">
                    <div className="mb-4 text-sm" > 
                        <div style={{width: '100%'}}>
                            <p><strong>Customer Name:</strong> {order.customer}</p>
                        </div>
                        <div className='border-t border-black pt-2' style={{width: '100%', textAlign: 'center', display: 'flex', justifyContent: 'space-between'}}>
                            <p><strong>Date:</strong> {new Date().toLocaleString()}</p>
                            <p><strong>Dine In:</strong> {order.table}</p>
                           
                        </div>
                        <div style={{width: '100%', 'display': 'flex', justifyContent: 'space-between'}}>
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
                          <img src={qrDataUrl} alt="valet-qr" className="mx-auto mt-2" style={{width: 150, height: 150}} />
                        ) : (
                          <p className="text-xs text-muted-foreground">Loading QR...</p>
                        )}
                    </div>
                </CardContent>
            </Card>
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

async function generateEscPos(): Promise<Uint8Array | null> {
    try {
        // dynamically import same helpers used above by re-parsing the open window state
        const searchParams = new URLSearchParams(window.location.search);
        const orderData = searchParams.get('order');
        if (!orderData) return null;
        const order = JSON.parse(decodeURIComponent(orderData));

        const authModule = await import('@/context/AuthContext');
        const user = authModule.useAuth().user;

        const encoder = new TextEncoder();
        const out: number[] = [];
        const ESC = 0x1b;
        const GS = 0x1d;
        const LF = 0x0a;

        const push = (arr: number[] | Uint8Array) => { for (const b of arr) out.push(b); };
        const text = (s: string) => push(Array.from(encoder.encode(s)));
        const nl = () => push([LF]);

        // init
        push([ESC, 0x40]);

        // header center
        push([ESC, 0x61, 0x01]); // center
        push([ESC, 0x45, 0x01]); // bold on
        text(order?.profile?.outlet_name ?? 'CuisineFlow'); nl();
        push([ESC, 0x45, 0x00]); // bold off
        if (order?.profile?.outlet_add) { text(order.profile.outlet_add); nl(); }
        nl();

        // left align meta
        push([ESC, 0x61, 0x00]);
        // try fetch server-side escpos logo bytes (to prepend later)
        let logoPrefix: Uint8Array | null = null;
        try {
            const resp = await fetch(`/restaurant/logo/escpos`, { headers: { 'X-Restaurant-Id': user?.restaurantId ?? '' } });
            if (resp.ok) {
                logoPrefix = new Uint8Array(await resp.arrayBuffer());
            }
        } catch (err) {
            // ignore logo fetch fail
        }
        text(`Name: ${order.customer}`); nl();
        text(`Bill No: ${order.id}`); nl();
        text(`Dine In: ${order.table}`); nl();
        text(`Cashier: ${((user?.emp_Fname ?? '') + (user?.emp_Lname ? ` ${user.emp_Lname}` : '')).trim()}`); nl();
        text(`Date: ${new Date().toLocaleString()}`); nl(); nl();

        // items header
        text('Item                Qty   Price   Amt'); nl();
        push([ESC, 0x2d, 0x01]); // underline on
        nl();
        for (const it of order.items) {
            const name = (it.name || '').slice(0,16).padEnd(16, ' ');
            const qty = String(it.quantity).padStart(3, ' ');
            const price = (Number(it.price) || 0).toFixed(2).padStart(7, ' ');
            const amt = (Number(it.price) * Number(it.quantity) || 0).toFixed(2).padStart(7, ' ');
            text(`${name}${qty}${price}${amt}`); nl();
        }
        push([ESC, 0x2d, 0x00]); // underline off
        nl();

        // totals
        const subtotal = Number(order.subtotal || 0);
        const totalQty = order.items.reduce((s: number, it: any) => s + (Number(it.quantity)||0), 0);
        text(`Total Qty: ${totalQty}`); nl();
        text(`Subtotal: ${subtotal.toFixed(2)}`); nl();
        if (order.serviceCharge && order.serviceChargePercentage) {
            text(`Service ${order.serviceChargePercentage}%: ${Number(order.serviceCharge).toFixed(2)}`); nl();
        }
        if (order.calculatedTaxes && Array.isArray(order.calculatedTaxes)) {
            for (const t of order.calculatedTaxes) {
                text(`${t.name} ${t.percentage}%: ${Number(t.amount).toFixed(2)}`); nl();
            }
        }
        const roundOff = Math.round(order.total) - order.total;
        text(`Round off: ${roundOff.toFixed(2)}`); nl();
        push([ESC, 0x61, 0x02]); // right align
        push([ESC, 0x45, 0x01]); // bold
        text(`Grand Total: ${(Number(order.total)||0).toFixed(2)}`); nl();
        push([ESC, 0x45, 0x00]); // bold off
        push([ESC, 0x61, 0x00]); // back to left
        nl(); nl();

        // Thanks
        push([ESC, 0x61, 0x01]);
        text('Thanks'); nl(); nl();

        // QR: try ESC/POS QR sequence (store, set size, print)
        try {
            const fallbackBase = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:9003` : '';
            const baseUrl = (process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL ?? fallbackBase).replace(/\/$/, '');
            if (baseUrl && user?.restaurantId && user?.employeeId) {
                const params = new URLSearchParams({ restaurantId: user.restaurantId, employeeId: user.employeeId });
                const feedbackUrl = `${baseUrl}?${params.toString()}`;
                const data = Array.from(new TextEncoder().encode(feedbackUrl));
                const length = data.length + 3;
                const pL = length & 0xff;
                const pH = (length >> 8) & 0xff;
                // store
                push([GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30, ...data]);
                // set size (module size 6)
                push([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06]);
                // set error correction level (48 = L)
                push([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x30]);
                // print
                push([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]);
                nl(); nl();
            }
        } catch (err) {
            // ignore QR failures
        }

        // cut
        push([GS, 0x56, 0x00]);

        const body = new Uint8Array(out);
        if (logoPrefix && logoPrefix.length > 0) {
            const combined = new Uint8Array(logoPrefix.length + body.length);
            combined.set(logoPrefix, 0);
            combined.set(body, logoPrefix.length);
            return combined;
        }
        return body;
    } catch (err) {
        console.error('ESC/POS generation failed', err);
        return null;
    }
}
