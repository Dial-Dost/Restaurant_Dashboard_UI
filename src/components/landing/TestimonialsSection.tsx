
"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AnimatedSection } from "@/components/AnimatedSection";
import { useTranslation } from "@/context/LanguageContext";

export default function TestimonialsSection() {
  const { t } = useTranslation();

  const testimonials = [
    {
      name: "Sarah L.",
      initials: "SL",
      quote: t('testimonial1'),
      image: "https://picsum.photos/seed/woman1/100/100",
      aiHint: "woman portrait"
    },
    {
      name: "Michael B.",
      initials: "MB",
      quote: t('testimonial2'),
      image: "https://picsum.photos/seed/man1/100/100",
      aiHint: "man portrait"
    },
    {
      name: "Jessica P.",
      initials: "JP",
      quote: t('testimonial3'),
      image: "https://picsum.photos/seed/woman2/100/100",
      aiHint: "woman smiling"
    },
    {
      name: "David H.",
      initials: "DH",
      quote: t('testimonial4'),
      image: "https://picsum.photos/seed/man2/100/100",
      aiHint: "man smiling"
    },
  ];

  return (
    <AnimatedSection id="testimonials">
      <div className="container mx-auto px-4 overflow-hidden">
        <h2 className="text-center text-4xl font-bold font-headline md:text-5xl mb-12">
          {t('testimonialsTitle')}
        </h2>
        <Carousel
          opts={{
            align: "start",
            loop: true,
          }}
          className="w-full max-w-4xl mx-auto"
        >
          <CarouselContent>
            {testimonials.map((testimonial, index) => (
              <CarouselItem key={index} className="md:basis-1/2 lg:basis-1/2">
                <Card className="h-full">
                  <CardContent className="flex flex-col items-center justify-center p-6 text-center h-full">
                    <p className="text-muted-foreground italic mb-6">"{testimonial.quote}"</p>
                    <div className="flex items-center">
                      <Avatar className="h-12 w-12 mr-4">
                        <AvatarImage src={testimonial.image} alt={testimonial.name} data-ai-hint={testimonial.aiHint} />
                        <AvatarFallback>{testimonial.initials}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-bold font-headline">{testimonial.name}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="hidden md:flex -left-4"/>
          <CarouselNext className="hidden md:flex -right-4"/>
        </Carousel>
      </div>
    </AnimatedSection>
  );
}
