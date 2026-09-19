"use client";

/**
 * Styled replacements for window.confirm / window.prompt — the web twins of the
 * app's `_confirm` / `_askText` dialog helpers (modules.dart). Imperative like
 * them: `const ok = await confirm({ title, body })`, so call sites read exactly
 * as the Flutter ones do.
 */

import * as React from "react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ConfirmOptions {
    title: string;
    body: React.ReactNode;
    /** Flutter's `_confirm` says "Confirm"; destructive flows may say "Delete". */
    confirmLabel?: string;
    cancelLabel?: string;
}

interface ConfirmState extends ConfirmOptions {
    resolve: (ok: boolean) => void;
}

export function useConfirm(): { confirm: (opts: ConfirmOptions) => Promise<boolean>; confirmDialog: React.ReactNode } {
    const [state, setState] = React.useState<ConfirmState | null>(null);

    const confirm = React.useCallback(
        (opts: ConfirmOptions) =>
            new Promise<boolean>((resolve) => {
                setState({ ...opts, resolve });
            }),
        [],
    );

    const settle = (ok: boolean): void => {
        setState((s) => {
            s?.resolve(ok);
            return null;
        });
    };

    const confirmDialog = state ? (
        <AlertDialog open onOpenChange={(o) => { if (!o) { settle(false); } }}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{state.title}</AlertDialogTitle>
                    <AlertDialogDescription className="whitespace-pre-line">{state.body}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => { settle(false); }}>{state.cancelLabel ?? "Cancel"}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => { settle(true); }}>{state.confirmLabel ?? "Confirm"}</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    ) : null;

    return { confirm, confirmDialog };
}

export interface PromptOptions {
    title: string;
    label: string;
    initial?: string;
    maxLength?: number;
    saveLabel?: string;
}

interface PromptState extends PromptOptions {
    resolve: (value: string | null) => void;
}

export function usePrompt(): { prompt: (opts: PromptOptions) => Promise<string | null>; promptDialog: React.ReactNode } {
    const [state, setState] = React.useState<PromptState | null>(null);
    const [value, setValue] = React.useState("");

    const prompt = React.useCallback(
        (opts: PromptOptions) =>
            new Promise<string | null>((resolve) => {
                setValue(opts.initial ?? "");
                setState({ ...opts, resolve });
            }),
        [],
    );

    const settle = (v: string | null): void => {
        setState((s) => {
            s?.resolve(v);
            return null;
        });
    };

    const promptDialog = state ? (
        <Dialog open onOpenChange={(o) => { if (!o) { settle(null); } }}>
            <DialogContent className="sm:max-w-[380px]">
                <DialogHeader>
                    <DialogTitle>{state.title}</DialogTitle>
                </DialogHeader>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        settle(value);
                    }}
                    className="grid gap-2"
                >
                    <Label htmlFor="menu-prompt-field">{state.label}</Label>
                    <Input
                        id="menu-prompt-field"
                        autoFocus
                        value={value}
                        maxLength={state.maxLength}
                        onChange={(e) => { setValue(e.target.value); }}
                    />
                    <DialogFooter className="mt-2">
                        <Button type="button" variant="ghost" onClick={() => { settle(null); }}>Cancel</Button>
                        <Button type="submit">{state.saveLabel ?? "Save"}</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    ) : null;

    return { prompt, promptDialog };
}
