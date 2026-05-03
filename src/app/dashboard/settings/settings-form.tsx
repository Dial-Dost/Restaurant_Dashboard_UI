
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
import { useAuth } from "@/context/AuthContext"
import { useCurrency } from "@/hooks/use-currency"
import { getRestaurantProfile, updateRestaurantProfile, RestaurantProfile } from "@/lib/db"

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

  const hasRole = (role: "admin" | "employee" | "valet" | "waiter" | "cashier" | "captain" | "manager") => {
    if (!user) return false
    if (user.role === role) return true
    return Array.isArray(user.role_all) ? user.role_all.includes(role) : false
  }

  const feedbackFormUrl = useMemo(() => {
    if (!user?.res_id || !user?.employeeId || !user?.outlet_id) {
      return ""
    }

    const fallbackBase = typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.hostname}:9003`
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
      currency: currency,
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
              currency: currency
          });
        }
        fetchProfile();
    }
    form.setValue("currency", currency);
  }, [user, currency, form])

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
        if (!active) return
        setFeedbackQrDataUrl(dataUrl)
        setFeedbackQrError("")
      } catch (error) {
        if (!active) return
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
    if(!user?.restaurantUsername) return;
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
    await updateRestaurantProfile(user.restaurantUsername, user.employeeId, profileData);
    setCurrency(data.currency);
    toast({
      title: "Settings saved!",
      description: "Your restaurant profile has been updated.",
    })
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
                    if (!feedbackFormUrl) return
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
