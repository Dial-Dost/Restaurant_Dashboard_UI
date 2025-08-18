
"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import Image from "next/image";
import { useTranslation } from "@/context/LanguageContext";

export default function HeroSection() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <section id="home" className="relative h-dvh flex items-center justify-center text-center animated-gradient">
      <div className={cn(
          "relative z-10 p-4 max-w-4xl",
          mounted && theme === 'light' ? 'text-slate-800' : 'text-white'
        )}>
        <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold font-headline mb-4 drop-shadow-lg">
          {t('heroTitle')}
        </h1>
        <p className="text-lg md:text-2xl mb-8 font-body drop-shadow-md">
          {t('heroSubtitle')}
        </p>
        <Button asChild size="lg" className="text-lg">
          <Link href="#features">{t('discoverFeatures')}</Link>
        </Button>
      </div>
    </section>
  );
}
