import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, MapPin, Phone } from "lucide-react";
import { AnimatedSection } from "@/components/AnimatedSection";

export default function AboutSection() {
  const info = [
    {
      icon: <MapPin className="h-10 w-10 text-primary" />,
      title: "Address",
      content: "123 Culinary Lane, Foodie City, FC 12345",
    },
    {
      icon: <Clock className="h-10 w-10 text-primary" />,
      title: "Opening Hours",
      content: "Mon-Fri: 11am - 10pm, Sat-Sun: 9am - 11pm",
    },
    {
      icon: <Phone className="h-10 w-10 text-primary" />,
      title: "Contact Us",
      content: "contact@cuisineflow.com, (123) 456-7890",
    },
  ];

  return (
    <AnimatedSection id="about" className="bg-secondary">
      <div className="container mx-auto px-4">
        <h2 className="text-center text-4xl font-bold font-headline md:text-5xl mb-12">
          Visit or Call
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {info.map((item) => (
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
