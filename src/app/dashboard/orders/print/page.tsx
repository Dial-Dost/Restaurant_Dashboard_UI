
"use client";

import { useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
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
};

function PrintPageContents() {
    const searchParams = useSearchParams();
    const orderData = searchParams.get('order');

    useEffect(() => {
        if (orderData) {
            // Delay print slightly to ensure content is rendered
            setTimeout(() => {
                window.print();
                window.onafterprint = () => {
                   window.close();
                };
            }, 500);
        }
    }, [orderData]);

    if (!orderData) {
        return (
            <div className="flex items-center justify-center h-screen">
                <p>No order data provided. This window will close automatically.</p>
            </div>
        );
    }
    
    const order: Order = JSON.parse(decodeURIComponent(orderData));

    return (
        <div className="p-8 bg-white text-black">
            <Card className="w-full max-w-2xl mx-auto shadow-none border-black">
                <CardHeader className="text-center border-b border-black pb-4">
                    <CardTitle className="text-3xl font-bold">CuisineFlow</CardTitle>
                    <CardDescription className="text-sm">
                        123 Culinary Lane, Foodie City, FC 12345
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-6">
                    <div className="flex justify-between mb-4 text-sm">
                        <div>
                            <p><strong>Table:</strong> {order.table}</p>
                            <p><strong>Customer:</strong> {order.customer}</p>
                        </div>
                        <div>
                            <p><strong>Order ID:</strong> {order.id}</p>
                            <p><strong>Date:</strong> {new Date().toLocaleDateString()}</p>
                        </div>
                    </div>
                    <Table>
                        <TableHeader>
                            <TableRow>
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
                                    <TableCell className="text-right">${item.price.toFixed(2)}</TableCell>
                                    <TableCell className="text-right">${(item.price * item.quantity).toFixed(2)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    <div className="mt-6 space-y-2 text-sm ml-auto max-w-xs">
                        <div className="flex justify-between border-t border-black pt-2">
                            <span>Subtotal</span>
                            <span>${order.subtotal.toFixed(2)}</span>
                        </div>
                        {order.serviceChargePercentage && (
                            <div className="flex justify-between">
                                <span>Service Charge ({order.serviceChargePercentage}%)</span>
                                <span>{order.applyServiceCharge ? `$${order.serviceCharge?.toFixed(2)}` : 'Opted-out'}</span>
                            </div>
                        )}
                        {order.calculatedTaxes?.map(tax => (
                             <div key={tax.id} className="flex justify-between">
                                <span>{tax.name} ({tax.percentage}%)</span>
                                <span>${tax.amount.toFixed(2)}</span>
                            </div>
                        ))}
                        <div className="flex justify-between font-bold text-lg border-t border-dashed border-black pt-2 mt-2">
                            <span>Total Due:</span>
                            <span>${order.total.toFixed(2)}</span>
                        </div>
                    </div>
                     <div className="text-center mt-8 text-xs text-gray-600">
                        <p>Thank you for dining with us!</p>
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
