
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookMarked, Users, BarChart2, Table } from "lucide-react";
import { AnimatedSection } from "@/components/AnimatedSection";
import { useTranslation } from "@/context/LanguageContext";

export default function FeaturesSection() {
  const { t } = useTranslation();
  
  const features = [
    {
      icon: <BookMarked className="h-8 w-8 mb-4 text-primary" />,
      name: t('feature1Title'),
      description: t('feature1Desc'),
      image: "https://picsum.photos/seed/booking/600/400",
      aiHint: "booking calendar",
    },
    {
      icon: <Table className="h-8 w-8 mb-4 text-primary" />,
      name: t('feature2Title'),
      description: t('feature2Desc'),
      image: "https://picsum.photos/seed/floorplan/600/400",
      aiHint: "restaurant floor plan",
    },
    {
      icon: <Users className="h-8 w-8 mb-4 text-primary" />,
      name: t('feature3Title'),
      description: t('feature3Desc'),
      image: "https://picsum.photos/seed/crm/600/400",
      aiHint: "customer database",
    },
    {
      icon: <BarChart2 className="h-8 w-8 mb-4 text-primary" />,
      name: t('feature4Title'),
      description: t('feature4Desc'),
      image: "https://picsum.photos/seed/analytics/600/400",
      aiHint: "analytics dashboard",
    },
  ];

  return (
    <AnimatedSection id="features">
      <div className="container mx-auto px-4">
        <h2 className="text-center text-4xl font-bold font-headline md:text-5xl mb-12">
          {t('featuresTitle')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {features.map((item) => (
            <Card key={item.name} className="flex flex-col text-center items-center overflow-hidden transition-all duration-300 hover:shadow-2xl hover:-translate-y-2">
              <div className="w-full h-40 relative">
                  <Image
                   src={item.image}
                   alt={item.name}
                   fill
                   className="object-cover"
                   sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw"
                   data-ai-hint={item.aiHint}
                  />
              </div>
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
