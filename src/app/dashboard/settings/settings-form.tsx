
"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
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
import { useToast } from "@/hooks/use-toast"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/context/AuthContext"

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
})

type SettingsFormValues = z.infer<typeof settingsFormSchema>

const defaultValues: Partial<SettingsFormValues> = {
  name: "",
  address: "123 Culinary Lane, Foodie City, FC 12345",
  phone: "(123) 456-7890",
  email: "manager@cuisineflow.com",
  hours: "Mon-Fri: 11am - 10pm, Sat-Sun: 9am - 11pm",
}

export function SettingsForm() {
  const { toast } = useToast()
  const { user } = useAuth()

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues,
  })

  useEffect(() => {
    if (user?.restaurantName) {
      form.setValue("name", user.restaurantName)
    }
  }, [user, form])

  function onSubmit(data: SettingsFormValues) {
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
            </CardContent>
        </Card>

        <Button type="submit">Update settings</Button>
      </form>
    </Form>
  )
}
