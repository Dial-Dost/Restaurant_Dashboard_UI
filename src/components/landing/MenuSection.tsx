import Image from "next/image";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AnimatedSection } from "@/components/AnimatedSection";

export default function MenuSection() {
  const menuItems = [
    {
      name: "Terracotta Tagine",
      description: "Slow-cooked lamb with apricots and almonds, a house specialty.",
      price: "$28.50",
      image: "https://placehold.co/600x400",
      aiHint: "lamb tagine",
      badge: "Signature",
    },
    {
      name: "Olive Grove Salad",
      description: "Fresh greens, Kalamata olives, feta, and a lemon-herb vinaigrette.",
      price: "$16.00",
      image: "https://placehold.co/600x400",
      aiHint: "greek salad",
      badge: "Vegan Option",
    },
    {
      name: "Seared Scallops",
      description: "With saffron risotto and asparagus spears.",
      price: "$32.00",
      image: "https://placehold.co/600x400",
      aiHint: "seared scallops",
      badge: "Popular",
    },
    {
      name: "Chocolate Lava Cake",
      description: "Molten chocolate center served with vanilla bean ice cream.",
      price: "$12.00",
      image: "https://placehold.co/600x400",
      aiHint: "lava cake",
    },
     {
      name: "Mushroom Risotto",
      description: "Creamy Arborio rice with wild mushrooms and parmesan cheese.",
      price: "$22.50",
      image: "https://placehold.co/600x400",
      aiHint: "mushroom risotto",
      badge: "Vegetarian"
    },
    {
      name: "Grilled Ribeye Steak",
      description: "12oz Prime Ribeye served with garlic mashed potatoes and seasonal vegetables.",
      price: "$45.00",
      image: "https://placehold.co/600x400",
      aiHint: "ribeye steak",
    },
  ];

  return (
    <AnimatedSection id="menu">
      <div className="container mx-auto px-4">
        <h2 className="text-center text-4xl font-bold font-headline md:text-5xl mb-12">
          From Our Kitchen
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {menuItems.map((item) => (
            <Card key={item.name} className="flex flex-col overflow-hidden transition-all duration-300 hover:shadow-2xl hover:-translate-y-2">
              <div className="relative">
                <Image 
                  src={item.image} 
                  width={600} 
                  height={400} 
                  alt={item.name} 
                  className="w-full h-56 object-cover"
                  data-ai-hint={item.aiHint}
                />
                {item.badge && <Badge variant="default" className="absolute top-3 right-3">{item.badge}</Badge>}
              </div>
              <CardHeader className="flex-grow">
                <CardTitle className="font-headline">{item.name}</CardTitle>
                <p className="text-muted-foreground mt-2 text-sm">{item.description}</p>
              </CardHeader>
              <CardFooter>
                <p className="text-xl font-bold text-primary">{item.price}</p>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </AnimatedSection>
  );
}
