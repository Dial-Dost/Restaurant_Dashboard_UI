import { NextResponse } from 'next/server';

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => null);
        const authUser = body?.authUser ?? null;
        // The outlet switcher's choice. Mirrored into a cookie because every data
        // accessor lives in the "use server" db.ts, which assembles X-Outlet-Id on
        // the server where localStorage does not exist. `null` clears the override.
        const hasOutletField = body != null && Object.prototype.hasOwnProperty.call(body, 'selectedOutletId');
        const selectedOutletId =
            typeof body?.selectedOutletId === 'string' && body.selectedOutletId.trim().length > 0
                ? body.selectedOutletId.trim()
                : null;

        if (!authUser && !hasOutletField) {
            return NextResponse.json({ ok: false, error: 'authUser is required' }, { status: 400 });
        }

        const res = NextResponse.json({ ok: true });

        if (authUser) {
            res.cookies.set({
                name: 'authUser',
                value: encodeURIComponent(JSON.stringify(authUser)),
                httpOnly: true,
                path: '/',
                maxAge: 60 * 60 * 24 * 365,
                sameSite: 'lax',
            });
        }

        if (hasOutletField) {
            if (selectedOutletId) {
                res.cookies.set({
                    name: 'selectedOutletId',
                    value: selectedOutletId,
                    httpOnly: true,
                    path: '/',
                    maxAge: 60 * 60 * 24 * 365,
                    sameSite: 'lax',
                });
            } else {
                res.cookies.set({ name: 'selectedOutletId', value: '', path: '/', maxAge: 0 });
            }
        }

        return res;
    } catch (err) {
        return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
    }
}

// Clears the server-side session cookie (and the outlet-switcher choice). Called
// by the login screen after an expired-session redirect so a dead session can't
// linger in the httpOnly cookie the server-side data accessors read.
export async function DELETE() {
    const res = NextResponse.json({ ok: true });
    res.cookies.set({ name: 'authUser', value: '', path: '/', maxAge: 0 });
    res.cookies.set({ name: 'selectedOutletId', value: '', path: '/', maxAge: 0 });
    return res;
}
