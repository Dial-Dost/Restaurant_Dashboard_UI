
"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, Controller } from "react-hook-form"
import { z } from "zod"
import { useEffect, useMemo, useState } from "react"
import QRCode from "qrcode"

import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/context/AuthContext"
import { useCurrency } from "@/hooks/use-currency"
import type { RestaurantProfile} from "@/lib/db";
import { getRestaurantProfile, updateRestaurantProfile, getRequireTableOtp, setRequireTableOtp } from "@/lib/db"
import { PERM_SETTINGS, hasPermission } from "@/lib/mis-capture"
import { BillPrintSettingsCard } from "./bill-print-settings"
import { BillingCountersCard } from "./billing-counters"
import { BrandingCustomizer } from "./branding-customizer"
import { PostersEditor } from "./posters-editor"
import { TimezoneSelector } from "./timezone-selector"

const settingsFormSchema = z.object({
  name: z
    .string()
    .min(2, {
      message: "Restaurant name must be at least 2 characters.",
    }),
  address: z
    .string()
    .min(10, {
      message: "Address must be at least 10 characters."
    }),
  phone: z
    .string()
    .min(10, {
      message: "Please enter a valid phone number."
    }),
  email: z
    .string()
    .email({
      message: "Please enter a valid email address.",
    }),
  hours: z
    .string()
    .min(5, {
      message: "Please enter your opening hours."
    }),
  currency: z.string(),
})

type SettingsFormValues = z.infer<typeof settingsFormSchema>
import Image from 'next/image';

export function SettingsForm() {
  const { toast } = useToast()
  const { user } = useAuth()
  const { currency, setCurrency, currencyOptions } = useCurrency();
  const [feedbackQrDataUrl, setFeedbackQrDataUrl] = useState<string>("")
  const [feedbackQrError, setFeedbackQrError] = useState<string>("")
  const [currentProfile, setCurrentProfile] = useState<RestaurantProfile | null>(null)
  const [requireOtp, setRequireOtp] = useState(false)
  const [otpSaving, setOtpSaving] = useState(false)

  const hasRole = (role: "admin" | "employee" | "valet" | "waiter" | "cashier" | "captain" | "manager") => {
    if (!user) {return false}
    if (user.role === role) {return true}
    return Array.isArray(user.role_all) ? user.role_all.includes(role) : false
  }

  const feedbackFormUrl = useMemo(() => {
    if (!user?.res_id || !user?.employeeId || !user?.outlet_id) {
      return ""
    }

    // The feedback form lives inside this app at /feedback, so same-origin is the
    // default; NEXT_PUBLIC_FEEDBACK_FORM_URL still overrides (e.g. a separately
    // hosted form).
    const fallbackBase = typeof window !== "undefined"
      ? `${window.location.origin}/feedback`
      : ""

    const configuredBase = (process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL ?? "").trim()
    let baseUrl = configuredBase || fallbackBase

    if (typeof window !== "undefined" && baseUrl) {
      try {
        const parsed = new URL(baseUrl)
        const configuredHost = parsed.hostname.toLowerCase()
        const currentHost = window.location.hostname.toLowerCase()
        const isConfiguredLocal = configuredHost === "localhost" || configuredHost === "127.0.0.1"
        const isCurrentLocal = currentHost === "localhost" || currentHost === "127.0.0.1"

        // Keep explicit public URLs as-is, but auto-fix local placeholders on deployed/forwarded hosts.
        if (isConfiguredLocal && !isCurrentLocal) {
          parsed.protocol = window.location.protocol
          parsed.hostname = window.location.hostname
          baseUrl = parsed.toString()
        }
      } catch {
        // Ignore invalid env URL and continue with fallback behavior.
      }
    }

    baseUrl = baseUrl.replace(/\/$/, "")
    if (!baseUrl) {
      return ""
    }

    const params = new URLSearchParams({
      restaurantId: String(user?.res_id ?? ""),
      employeeId: String(user?.employeeId ?? ""),
      outletId: String(user?.outlet_id ?? ""),
    })
    return `${baseUrl}?${params.toString()}`
  }, [user?.res_id, user?.employeeId, user?.outlet_id])

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      name: "",
      address: "",
      phone: "",
      email: "",
      hours: "",
      currency,
    }
  })

  useEffect(() => {
    if (user?.restaurantUsername) {
        const fetchProfile = async () => {
          const profile = await getRestaurantProfile(user.restaurantUsername, user.employeeId);
          setCurrentProfile(profile);
          form.reset({
              name: profile.restaurant_name || "",
              address: profile.outlet_add || "",
              phone: profile.outlet_phone || "",
              email: profile.email || "",
              hours: profile.outlet_hours || "",
              currency
          });
        }
        fetchProfile();
    }
    form.setValue("currency", currency);
  }, [user, currency, form])

  useEffect(() => {
    if (!user?.restaurantUsername) {return}
    let active = true
    getRequireTableOtp(user.restaurantUsername)
      .then((v) => { if (active) {setRequireOtp(v)} })
      .catch(() => {/* leave default off */})
    return () => { active = false }
  }, [user?.restaurantUsername])

  const handleRequireOtpChange = async (next: boolean) => {
    if (!user?.restaurantUsername) {return}
    if (!hasRole("admin")) {
      toast({
        title: "Access denied",
        description: "You do not have the required role for this action. Required role: admin.",
        variant: "destructive",
      })
      return
    }
    const previous = requireOtp
    setRequireOtp(next) // optimistic
    setOtpSaving(true)
    try {
      const saved = await setRequireTableOtp(user.restaurantUsername, next)
      setRequireOtp(saved)
      toast({
        title: "Settings saved!",
        description: saved
          ? "Guests must now enter the table code before ordering."
          : "Guests can order without a table code.",
      })
    } catch (error: any) {
      setRequireOtp(previous) // revert on failure
      toast({
        title: "Couldn't save setting",
        description: error?.message ?? "Unable to update the table OTP setting.",
        variant: "destructive",
      })
    } finally {
      setOtpSaving(false)
    }
  }

  useEffect(() => {
    let active = true

    const buildQr = async () => {
      if (!feedbackFormUrl) {
        if (active) {
          setFeedbackQrDataUrl("")
          setFeedbackQrError("Feedback URL is unavailable.")
        }
        return
      }

      try {
        const dataUrl = await QRCode.toDataURL(feedbackFormUrl, {
          width: 280,
          margin: 2,
        })
        if (!active) {return}
        setFeedbackQrDataUrl(dataUrl)
        setFeedbackQrError("")
      } catch (error) {
        if (!active) {return}
        setFeedbackQrDataUrl("")
        setFeedbackQrError("Unable to generate QR code")
      }
    }

    buildQr()
    return () => {
      active = false
    }
  }, [feedbackFormUrl])

  // important: need to update this function according to the new RestaurantProfileRecord class
  async function onSubmit(data: SettingsFormValues) {
    if(!user?.restaurantUsername) {return;}
    if (!hasRole("admin")) {
      toast({
        title: "Access denied",
        description: "You do not have the required role for this action. Required role: admin.",
        variant: "destructive",
      })
      return
    }

    const profileData: RestaurantProfile = {
        restaurant_name: data.name,
        outlet_add: data.address,
        outlet_phone: data.phone,
        email: data.email,
        outlet_hours: data.hours,
        res_id: currentProfile?.res_id ?? user.res_id ?? user.restaurantUsername,
        restaurant_username: currentProfile?.restaurant_username ?? data.name,
        restaurant_main_office_add: currentProfile?.restaurant_main_office_add ?? data.address,
        restaurant_logo_url: currentProfile?.restaurant_logo_url ?? null,
        outlet_id: currentProfile?.outlet_id ?? user.outlet_id ?? "main",
        outlet_name: currentProfile?.outlet_name ?? data.name,
    };
    try {
      await updateRestaurantProfile(user.restaurantUsername, user.employeeId, profileData);
      setCurrency(data.currency);
      toast({
        title: "Settings saved!",
        description: "Your restaurant profile has been updated.",
      })
    } catch (error: any) {
      toast({
        title: "Couldn't save settings",
        description: error?.message ?? "Unable to update profile.",
        variant: "destructive",
      })
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <Card>
            <CardHeader>
                <CardTitle>Restaurant Profile</CardTitle>
                <CardDescription>Update your restaurants public information here.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                 <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Restaurant Name</FormLabel>
                        <FormControl>
                            <Input placeholder="Your restaurant's name" {...field} />
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
                <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Address</FormLabel>
                        <FormControl>
                            <Textarea
                                placeholder="123 Main St, Anytown, USA"
                                className="resize-none"
                                {...field}
                                />
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
                <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Phone Number</FormLabel>
                        <FormControl>
                            <Input placeholder="(123) 456-7890" {...field} />
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
                <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Contact Email</FormLabel>
                        <FormControl>
                            <Input placeholder="contact@yourrestaurant.com" {...field} />
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
                <FormField
                    control={form.control}
                    name="hours"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Opening Hours</FormLabel>
                        <FormControl>
                            <Input placeholder="e.g., Mon-Fri: 9am - 10pm" {...field} />
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
                <FormField
                    control={form.control}
                    name="currency"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Currency</FormLabel>
                          <Controller
                            name="currency"
                            control={form.control}
                            render={({ field }) => (
                              <Select onValueChange={field.onChange} value={field.value}>
                                  <SelectTrigger>
                                      <SelectValue placeholder="Select a currency" />
                                  </SelectTrigger>
                                  <SelectContent>
                                      {Object.entries(currencyOptions).map(([code, { label }]) => (
                                        <SelectItem key={code} value={code}>{label}</SelectItem>
                                      ))}
                                  </SelectContent>
                              </Select>
                            )}
                          />
                        <FormMessage />
                        </FormItem>
                    )}
                    />
            </CardContent>
        </Card>

        {user?.restaurantUsername ? (
          <TimezoneSelector restaurantId={user.restaurantUsername} isAdmin={hasRole("admin")} />
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Ordering</CardTitle>
            <CardDescription>Controls for how guests place orders from the QR menu.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="require-table-otp" className="text-sm font-medium">Require table OTP to order</Label>
                <p className="text-sm text-muted-foreground">
                  Guests must enter a 4-digit code shown by staff before they can order.
                </p>
              </div>
              <Switch
                id="require-table-otp"
                checked={requireOtp}
                onCheckedChange={handleRequireOtpChange}
                disabled={otpSaving || !hasRole("admin")}
                aria-label="Require table OTP to order"
              />
            </div>
          </CardContent>
        </Card>

        {user?.restaurantUsername ? (
          <BillPrintSettingsCard restaurantId={user.restaurantUsername} isAdmin={hasRole("admin")} />
        ) : null}

        {/* Sits beside the bill-print card because both answer "how does this
            outlet ring a bill". Visible to everyone who can open Settings —
            seeing which tills exist is not a configuration act — and editable
            only with the settings permission the backend's POST requires, which
            is what `canEdit` carries. */}
        {user?.restaurantUsername ? (
          <BillingCountersCard
            restaurantId={user.restaurantUsername}
            canEdit={hasPermission(user.actions_set, PERM_SETTINGS)}
          />
        ) : null}

        {hasRole("admin") && user?.restaurantUsername ? (
          <BrandingCustomizer
            restaurantId={user.restaurantUsername}
            isAdmin={hasRole("admin")}
            restaurantName={currentProfile?.restaurant_name || form.watch("name")}
          />
        ) : null}

        {/* Sits directly under the branding card because it is the same job —
            what the guest pages look like — and is gated the same way (the
            backend routes require Manage Branding). */}
        {hasRole("admin") && user?.restaurantUsername ? (
          <PostersEditor restaurantId={user.restaurantUsername} isAdmin={hasRole("admin")} />
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>My Feedback QR</CardTitle>
            <CardDescription>
              Share this QR with customers so feedback is linked to your employee profile.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <FormLabel>Feedback Link</FormLabel>
              <Input value={feedbackFormUrl} readOnly />
            </div>

            {feedbackQrDataUrl ? (
              <div className="space-y-3">
                <Image
                  src={feedbackQrDataUrl}
                  alt="Feedback QR code"
                  width={224}
                  height={224}
                  className="h-56 w-56 rounded-md border bg-white p-2"
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={async () => {
                    if (!feedbackFormUrl) {return}
                    try {
                      await navigator.clipboard.writeText(feedbackFormUrl)
                      toast({ title: "Link copied", description: "Feedback link copied to clipboard." })
                    } catch {
                      toast({ title: "Copy failed", description: "Could not copy feedback link." })
                    }
                  }}>
                    Copy Link
                  </Button>
                  <Button asChild type="button">
                    <a href={feedbackQrDataUrl} download={`feedback-qr-${user?.employeeId ?? "employee"}.png`}>
                      Download QR
                    </a>
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{feedbackQrError || "Generating QR code..."}</p>
            )}
          </CardContent>
        </Card>

        <Button type="submit">Update settings</Button>
      </form>
    </Form>
  )
}
