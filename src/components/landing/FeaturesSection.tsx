import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookMarked, Users, BarChart2, Table } from "lucide-react";
import { AnimatedSection } from "@/components/AnimatedSection";

export default function FeaturesSection() {
  const features = [
    {
      icon: <BookMarked className="h-8 w-8 mb-4 text-primary" />,
      name: "Effortless Booking Management",
      description: "Handle all your reservations from one simple, powerful interface. Add, edit, and track bookings with ease.",
      image: "https://placehold.co/600x400",
      aiHint: "booking calendar",
    },
    {
      icon: <Table className="h-8 w-8 mb-4 text-primary" />,
      name: "Visual Table Management",
      description: "Get a real-time overview of your restaurant floor. Assign tables, track status, and optimize seating.",
      image: "https://placehold.co/600x400",
      aiHint: "restaurant floor plan",
    },
    {
      icon: <Users className="h-8 w-8 mb-4 text-primary" />,
      name: "Customer Relationship Hub",
      description: "Keep track of your guests and their preferences to provide personalized service and build loyalty.",
      image: "https://placehold.co/600x400",
      aiHint: "customer database",
    },
    {
      icon: <BarChart2 className="h-8 w-8 mb-4 text-primary" />,
      name: "In-Depth Analytics",
      description: "Make informed decisions with detailed reports on bookings, revenue, and customer trends.",
      image: "https://placehold.co/600x400",
      aiHint: "analytics dashboard",
    },
  ];

  return (
    <AnimatedSection id="features">
      <div className="container mx-auto px-4">
        <h2 className="text-center text-4xl font-bold font-headline md:text-5xl mb-12">
          Everything You Need to Succeed
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {features.map((item) => (
            <Card key={item.name} className="flex flex-col text-center items-center overflow-hidden transition-all duration-300 hover:shadow-2xl hover:-translate-y-2">
              <CardHeader className="flex-grow">
                 {item.icon}
                <CardTitle className="font-headline text-xl">{item.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mt-2 text-sm">{item.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AnimatedSection>
  );
}
