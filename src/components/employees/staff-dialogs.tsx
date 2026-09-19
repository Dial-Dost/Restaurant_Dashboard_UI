"use client";

// Add employee (`_addEmployee`), Reset password (`_resetPassword`) and the
// password-requests banner (`_PasswordRequestsBanner`) — modules.dart ~30800
// and ~36192.

import * as React from "react";
import { KeyRound, LockKeyhole, UserPlus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import type { PasswordResetRequest, RoleDefinition } from "@/lib/db";

export interface NewEmployee {
  emp_Fname: string;
  emp_Lname: string;
  username: string;
  password: string;
  email: string;
  role: string;
}

/** No Admin option — admin is owner-grantable only. Employee preselected. */
const BUILT_IN_OPTIONS: readonly [string, string][] = [
  ["employee", "Employee"],
  ["manager", "Manager"],
  ["cashier", "Cashier"],
  ["waiter", "Waiter"],
  ["captain", "Captain"],
  ["valet", "Valet"],
];

export function AddEmployeeDialog({
  customRoles,
  onSubmit,
  onOpenChange,
}: {
  customRoles: RoleDefinition[];
  onSubmit: (v: NewEmployee) => Promise<boolean>;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const [v, setV] = React.useState<NewEmployee>({
    emp_Fname: "",
    emp_Lname: "",
    username: "",
    password: "",
    email: "",
    role: "employee",
  });
  const [busy, setBusy] = React.useState(false);
  const set = (k: keyof NewEmployee) => (e: React.ChangeEvent<HTMLInputElement>): void => {
    setV((p) => ({ ...p, [k]: e.target.value }));
  };
  const submit = async (): Promise<void> => {
    setBusy(true);
    const ok = await onSubmit({
      ...v,
      emp_Fname: v.emp_Fname.trim(),
      emp_Lname: v.emp_Lname.trim(),
      username: v.username.trim(),
      email: v.email.trim(),
    });
    setBusy(false);
    if (ok) { onOpenChange(false); }
  };
  const customs = customRoles.filter((r) => r.id && r.role_name);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <div className="micro-label">Staff</div>
          <DialogTitle>Add employee</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="emp-first">First name</Label>
              <Input id="emp-first" value={v.emp_Fname} onChange={set("emp_Fname")} autoFocus />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="emp-last">Last name</Label>
              <Input id="emp-last" value={v.emp_Lname} onChange={set("emp_Lname")} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="emp-username">Username</Label>
            <Input id="emp-username" value={v.username} onChange={set("username")} autoComplete="off" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="emp-password">Password</Label>
            <Input id="emp-password" type="password" value={v.password} onChange={set("password")} autoComplete="new-password" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="emp-email">Email (optional)</Label>
            <Input id="emp-email" type="email" value={v.email} onChange={set("email")} />
          </div>
          <div className="grid gap-1.5">
            <Label>Role</Label>
            <Select value={v.role} onValueChange={(role) => { setV((p) => ({ ...p, role })); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {BUILT_IN_OPTIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
                {customs.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.role_name} (custom)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { onOpenChange(false); }} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy || !v.username.trim() || !v.password}>
              <UserPlus /> {busy ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ResetPasswordDialog({
  name,
  onSubmit,
  onOpenChange,
}: {
  name: string;
  onSubmit: (password: string) => Promise<boolean>;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const [pw, setPw] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const submit = async (): Promise<void> => {
    if (!pw.trim()) { return; }
    setBusy(true);
    const ok = await onSubmit(pw.trim());
    setBusy(false);
    if (ok) { onOpenChange(false); }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Reset password — {name}</DialogTitle>
        </DialogHeader>
        <form className="grid gap-1.5" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            autoFocus
            placeholder="At least 4 characters"
            value={pw}
            onChange={(e) => { setPw(e.target.value); }}
            autoComplete="new-password"
          />
          <DialogFooter className="mt-3">
            <Button type="button" variant="outline" onClick={() => { onOpenChange(false); }} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy || !pw.trim()}>{busy ? "Saving…" : "Set password"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Warning-tinted banner, "Action needed" chip, ghost Reset + icon Dismiss. */
export function PasswordRequestsBanner({
  requests,
  onReset,
  onDismiss,
}: {
  requests: PasswordResetRequest[];
  onReset: (r: PasswordResetRequest) => void;
  onDismiss: (r: PasswordResetRequest) => void;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-warning/[0.28] bg-warning/[0.12] px-4 pb-2 pt-3.5">
      <div className="flex items-center gap-2">
        <LockKeyhole className="h-4 w-4 shrink-0 text-warning" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {requests.length} password reset request{requests.length > 1 ? "s" : ""}
        </span>
        <StatusChip status="warning" label="Action needed" dense />
      </div>
      <div className="mt-1.5">
        {requests.map((r) => (
          <div key={r.id} className="flex items-center gap-2 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{r.name}</div>
              <div className="truncate text-xs text-muted-foreground">@{r.username}</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => { onReset(r); }}>
              <KeyRound /> Reset
            </Button>
            <Button size="icon" variant="ghost" aria-label="Dismiss" title="Dismiss" onClick={() => { onDismiss(r); }}>
              <X />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
