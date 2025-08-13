"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Line, LineChart } from "recharts"
import { useIsMobile } from "@/hooks/use-mobile"

const monthlyBookingsData = [
  { month: "January", desktop: 186, mobile: 80 },
  { month: "February", desktop: 305, mobile: 200 },
  { month: "March", desktop: 237, mobile: 120 },
  { month: "April", desktop: 73, mobile: 190 },
  { month: "May", desktop: 209, mobile: 130 },
  { month: "June", desktop: 214, mobile: 140 },
]

const monthlyBookingsConfig = {
  desktop: {
    label: "Desktop",
    color: "hsl(var(--primary))",
  },
  mobile: {
    label: "Mobile",
    color: "hsl(var(--secondary))",
  },
}

const bookingTimeData = [
  { time: "5 PM", bookings: 12 },
  { time: "6 PM", bookings: 25 },
  { time: "7 PM", bookings: 48 },
  { time: "8 PM", bookings: 55 },
  { time: "9 PM", bookings: 32 },
  { time: "10 PM", bookings: 15 },
];

const bookingTimeConfig = {
  bookings: {
    label: "Bookings",
    color: "hsl(var(--primary))",
  },
};

const dailyFrequencyData = [
    { day: 'Mon', bookings: 32 },
    { day: 'Tue', bookings: 45 },
    { day: 'Wed', bookings: 50 },
    { day: 'Thu', bookings: 65 },
    { day: 'Fri', bookings: 90 },
    { day: 'Sat', bookings: 120 },
    { day: 'Sun', bookings: 80 },
];

const dailyFrequencyConfig = {
    bookings: {
        label: "Bookings",
        color: "hsl(var(--primary))",
    }
}


export default function AnalyticsPage() {
  const isMobile = useIsMobile();
  
  return (
    <div className="grid gap-4 md:gap-8">
      <div className="flex items-center justify-between">
         <h1 className="text-lg font-semibold md:text-2xl">Analytics</h1>
      </div>
      <div className="grid gap-4 md:grid-cols-2 md:gap-8">
          <Card>
            <CardHeader>
                <CardTitle>Bookings Overview</CardTitle>
                <CardDescription>Comparison of bookings from different devices over the past 6 months.</CardDescription>
            </CardHeader>
            <CardContent className="pl-2">
                <ChartContainer config={monthlyBookingsConfig} className="h-[250px] w-full">
                <BarChart
                    accessibilityLayer
                    data={monthlyBookingsData}
                    layout={isMobile ? "vertical" : "horizontal"}
                    margin={{ top: 5, right: 10, left: isMobile ? -8 : 10, bottom: 5 }}
                >
                    <CartesianGrid horizontal={isMobile} vertical={!isMobile} />
                    {isMobile ? (
                        <>
                            <YAxis dataKey="month" type="category" tickLine={false} axisLine={false} tickMargin={10} width={70}/>
                            <XAxis type="number" dataKey="desktop"/>
                        </>
                    ) : (
                        <>
                            <YAxis type="number" />
                            <XAxis dataKey="month" type="category" tickLine={false} axisLine={false} tickMargin={10}/>
                        </>
                    )}
                    <ChartTooltip
                        cursor={false}
                        content={<ChartTooltipContent indicator="line" />}
                    />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar dataKey="desktop" fill="var(--color-desktop)" radius={4} />
                    <Bar dataKey="mobile" fill="var(--color-mobile)" radius={4} />
                </BarChart>
                </ChartContainer>
            </CardContent>
        </Card>
        <Card>
            <CardHeader>
                <CardTitle>Peak Booking Times</CardTitle>
                <CardDescription>Analysis of booking volume by hour of the day.</CardDescription>
            </CardHeader>
            <CardContent>
                <ChartContainer config={bookingTimeConfig} className="h-[250px] w-full">
                    <LineChart
                        data={bookingTimeData}
                        margin={{ top: 5, right: 10, left: -20, bottom: 5 }}
                    >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="time" />
                        <YAxis />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <ChartLegend content={<ChartLegendContent />} />
                        <Line type="monotone" dataKey="bookings" stroke="var(--color-bookings)" strokeWidth={2} />
                    </LineChart>
                </ChartContainer>
            </CardContent>
        </Card>
        <Card className="md:col-span-2">
            <CardHeader>
                <CardTitle>Daily Booking Frequency</CardTitle>
                <CardDescription>Number of bookings received each day of the week.</CardDescription>
            </CardHeader>
            <CardContent>
                 <ChartContainer config={dailyFrequencyConfig} className="h-[300px] w-full">
                    <BarChart data={dailyFrequencyData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="day" />
                        <YAxis />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <ChartLegend content={<ChartLegendContent />} />
                        <Bar dataKey="bookings" fill="var(--color-bookings)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ChartContainer>
            </CardContent>
        </Card>
      </div>
    </div>
  );
}
