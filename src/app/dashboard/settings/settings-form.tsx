
"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, Controller } from "react-hook-form"
import { z } from "zod"
import { useEffect } from "react"

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

export function SettingsForm() {
  const { toast } = useToast()
  const { user } = useAuth()
  const { currency, setCurrency, currencyOptions } = useCurrency();

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
    if (user?.restaurantId) {
        const fetchProfile = async () => {
          const profile = await getRestaurantProfile(user.restaurantId);
          form.reset({
              name: profile.name || "",
              address: profile.address || "",
              phone: profile.phone || "",
              email: profile.email || "",
              hours: profile.hours || "",
              currency: currency
          });
        }
        fetchProfile();
    }
    form.setValue("currency", currency);
  }, [user, currency, form])

  async function onSubmit(data: SettingsFormValues) {
    if(!user?.restaurantId) return;

    const profileData: RestaurantProfile = {
        name: data.name,
        address: data.address,
        phone: data.phone,
        email: data.email,
        hours: data.hours,
    };
    await updateRestaurantProfile(user.restaurantId, profileData);
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
                <CardDescription>Update your restaurant's public information here.</CardDescription>
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

        <Button type="submit">Update settings</Button>
      </form>
    </Form>
  )
}
