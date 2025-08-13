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
        alt="A modern restaurant dashboard shown on a laptop" 
        className="z-0 brightness-[0.4]"
        data-ai-hint="restaurant management software"
      />
      <div className="relative z-10 p-4 text-white max-w-4xl">
        <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold font-headline mb-4 drop-shadow-lg">
          Streamline Your Restaurant Operations
        </h1>
        <p className="text-lg md:text-2xl mb-8 font-body drop-shadow-md">
          CuisineFlow is the all-in-one platform to manage bookings, tables, customers, and analytics, all in one place.
        </p>
        <Button asChild size="lg" className="text-lg">
          <Link href="#features">Discover Features</Link>
        </Button>
      </div>
    </section>
  );
}
