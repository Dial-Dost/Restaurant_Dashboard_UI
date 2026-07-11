import { redirect } from "next/navigation";

// The real onboarding flow is restaurant registration (creates the restaurant +
// its first admin) at /signup/restaurant. This route previously rendered a fake
// "Create Employee Account" form that only showed an alert and created nothing —
// employees are added by an admin from the dashboard, not via self-signup. Send
// anyone landing here to the canonical registration page.
export default function SignUpPage() {
  redirect("/signup/restaurant");
}
