
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, BarChart, Package } from "lucide-react";
import { AnimatedSection } from "@/components/AnimatedSection";
import { useTranslation } from "@/context/LanguageContext";

export default function AboutSection() {
  const { t } = useTranslation();

  const benefits = [
    {
      icon: <Users className="h-10 w-10 text-primary" />,
      title: t('benefit1Title'),
      content: t('benefit1Desc'),
    },
    {
      icon: <BarChart className="h-10 w-10 text-primary" />,
      title: t('benefit2Title'),
      content: t('benefit2Desc'),
    },
    {
      icon: <Package className="h-10 w-10 text-primary" />,
      title: t('benefit3Title'),
      content: t('benefit3Desc'),
    },
  ];

  return (
    <AnimatedSection id="about" className="bg-muted">
      <div className="container mx-auto px-4">
        <h2 className="text-center text-4xl font-bold font-headline md:text-5xl mb-12">
          {t('aboutTitle')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {benefits.map((item) => (
            <Card key={item.title} className="text-center shadow-lg border-2 border-transparent hover:border-primary transition-colors duration-300 bg-background">
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
