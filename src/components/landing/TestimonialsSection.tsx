
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

export default function TestimonialsSection() {
  const testimonials = [
    {
      name: "Sarah L.",
      initials: "SL",
      quote: "The atmosphere is cozy and inviting, and the food is simply divine. The Terracotta Tagine is a must-try! A true 5-star experience.",
      image: "https://placehold.co/100x100",
      aiHint: "woman portrait"
    },
    {
      name: "Michael B.",
      initials: "MB",
      quote: "CuisineFlow has become our go-to for special occasions. The service is impeccable and every dish is a work of art. Highly recommended.",
      image: "https://placehold.co/100x100",
      aiHint: "man portrait"
    },
    {
      name: "Jessica P.",
      initials: "JP",
      quote: "I was impressed by the attention to detail in everything. From the decor to the presentation of the food, everything was perfect.",
      image: "https://placehold.co/100x100",
      aiHint: "woman smiling"
    },
    {
      name: "David H.",
      initials: "DH",
      quote: "A fantastic dining experience. The Olive Grove Salad was so fresh and flavorful. We'll definitely be back to explore more of the menu.",
      image: "https://placehold.co/100x100",
      aiHint: "man smiling"
    },
  ];

  return (
    <AnimatedSection id="testimonials">
      <div className="container mx-auto px-4 overflow-hidden">
        <h2 className="text-center text-4xl font-bold font-headline md:text-5xl mb-12">
          Words from Our Guests
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
