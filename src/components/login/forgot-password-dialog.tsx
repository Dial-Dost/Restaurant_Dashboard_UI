"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { sendPasswordReset } from "@/services/authService";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantName: string;
  initialUsername: string;
}

/** Flutter's in-card forgot-password AlertDialog (admin-notification request). */
export function ForgotPasswordDialog({ open, onOpenChange, restaurantName, initialUsername }: Props): React.JSX.Element {
  const { toast } = useToast();
  const [username, setUsername] = useState(initialUsername);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setUsername(initialUsername);
      setError(null);
    }
  }, [open, initialUsername]);

  const submit = async (e: React.SyntheticEvent): Promise<void> => {
    e.preventDefault();
    const name = username.trim();
    if (!name) {
      setError("Required");
      return;
    }
    setBusy(true);
    try {
      await sendPasswordReset(restaurantName, name);
      onOpenChange(false);
      toast({ description: "Request sent. Ask your admin to set a new password for you." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) { onOpenChange(v); } }}>
      <DialogContent className="max-w-[400px]">
        <form onSubmit={(e) => { void submit(e); }} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Forgot password?</DialogTitle>
            <DialogDescription>
              Enter your username. Your restaurant admin will be notified to reset your password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="forgot-username">Username</Label>
            <Input
              id="forgot-username"
              autoFocus
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(null); }}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => { onOpenChange(false); }}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Sending" /> : "Send request"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
