import Image from "next/image";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function HeroSection() {
  return (
    <section id="home" className="relative h-dvh flex items-center justify-center text-center">
      <Image 
        src="https://placehold.co/1920x1080" 
        fill
        priority
        style={{objectFit:"cover"}} 
        alt="A beautifully set table in a restaurant" 
        className="z-0 brightness-[0.4]"
        data-ai-hint="restaurant dining"
      />
      <div className="relative z-10 p-4 text-white max-w-4xl">
        <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold font-headline mb-4 drop-shadow-lg">
          Effortless Elegance, Managed Perfectly
        </h1>
        <p className="text-lg md:text-2xl mb-8 font-body drop-shadow-md">
          CuisineFlow brings you a seamless restaurant management experience, from menu to guest.
        </p>
        <Button asChild size="lg" className="text-lg">
          <Link href="#menu">Explore Our World</Link>
        </Button>
      </div>
    </section>
  );
}
