import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, BarChart, Package } from "lucide-react";
import { AnimatedSection } from "@/components/AnimatedSection";

export default function AboutSection() {
  const benefits = [
    {
      icon: <Users className="h-10 w-10 text-primary" />,
      title: "For Your Team",
      content: "Empower your staff with intuitive tools that reduce manual work and let them focus on providing excellent service.",
    },
    {
      icon: <BarChart className="h-10 w-10 text-primary" />,
      title: "For Your Business",
      content: "Gain valuable insights with powerful analytics, helping you make data-driven decisions to boost profitability.",
    },
    {
      icon: <Package className="h-10 w-10 text-primary" />,
      title: "For Your Guests",
      content: "Ensure a seamless dining experience from booking to billing, increasing customer satisfaction and loyalty.",
    },
  ];

  return (
    <AnimatedSection id="about" className="bg-secondary">
      <div className="container mx-auto px-4">
        <h2 className="text-center text-4xl font-bold font-headline md:text-5xl mb-12">
          Designed for Growth
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {benefits.map((item) => (
            <Card key={item.title} className="text-center shadow-lg border-2 border-transparent hover:border-primary transition-colors duration-300">
              <CardHeader className="flex items-center justify-center">
                {item.icon}
              </CardHeader>
              <CardContent>
                <CardTitle className="mb-2 font-headline">{item.title}</CardTitle>
                <p className="text-muted-foreground">{item.content}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AnimatedSection>
  );
}
