import { NextResponse } from 'next/server';

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => null) as any;
        const authUser = body?.authUser ?? null;
        if (!authUser) {
            return NextResponse.json({ ok: false, error: 'authUser is required' }, { status: 400 });
        }

        const value = encodeURIComponent(JSON.stringify(authUser));

        const res = NextResponse.json({ ok: true });
        res.cookies.set({
            name: 'authUser',
            value,
            httpOnly: true,
            path: '/',
            maxAge: 60 * 60 * 24 * 365,
            sameSite: 'lax',
        });

        return res;
    } catch (err) {
        return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
    }
}
