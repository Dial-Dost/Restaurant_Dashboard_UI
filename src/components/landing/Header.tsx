
"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Menu, ChefHat, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from '../ui/separator';
import { ThemeToggle } from '../ThemeToggle';

export default function Header() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { href: '#features', label: 'Features' },
    { href: '#about', label: 'About' },
    { href: '#testimonials', label: 'Reviews' },
    { href: '#contact', label: 'Contact' },
  ];

  return (
    <header className={cn(
      "sticky top-0 z-50 w-full transition-all duration-300",
      isScrolled ? 'bg-background/80 shadow-md backdrop-blur-sm' : 'bg-transparent'
    )}>
      <div className="container mx-auto flex h-20 items-center justify-between px-4">
        <Link href="#home" className="flex items-center gap-2 font-bold text-2xl font-headline">
          <ChefHat className="h-8 w-8 text-primary" />
          <span>CuisineFlow</span>
        </Link>
        
        <nav className="hidden md:flex items-center space-x-1">
          {navLinks.map((link) => (
            <Button key={link.href} variant="ghost" asChild>
              <Link href={link.href}>{link.label}</Link>
            </Button>
          ))}
           <Button asChild>
              <Link href="/login">Login</Link>
            </Button>
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Globe className="h-5 w-5" />
                  <span className="sr-only">Select language</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>English</DropdownMenuItem>
                <DropdownMenuItem>हिन्दी (Hindi)</DropdownMenuItem>
                <DropdownMenuItem>ಕನ್ನಡ (Kannada)</DropdownMenuItem>
                <DropdownMenuItem>తెలుగు (Telugu)</DropdownMenuItem>
                <DropdownMenuItem>தமிழ் (Tamil)</DropdownMenuItem>
                <DropdownMenuItem>മലയാളം (Malayalam)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
        </nav>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild className="md:hidden">
            <Button variant="ghost" size="icon">
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent side="right">
            <nav className="flex flex-col space-y-2 mt-8">
              {navLinks.map((link) => (
                <Button key={link.href} variant="ghost" asChild onClick={() => setOpen(false)} className="justify-start">
                  <Link href={link.href}>{link.label}</Link>
                </Button>
              ))}
              <Button asChild onClick={() => setOpen(false)} className="justify-start">
                  <Link href="/login">Login</Link>
              </Button>
              <Separator className="my-2"/>
              <div className='px-2 py-1'>
                <ThemeToggle />
              </div>
              <Separator className="my-2"/>
              <p className="text-sm text-muted-foreground px-2">Language</p>
               <Button variant="ghost" className="w-full justify-start">English</Button>
              <Button variant="ghost" className="w-full justify-start">हिन्दी (Hindi)</Button>
              <Button variant="ghost" className="w-full justify-start">ಕನ್ನಡ (Kannada)</Button>
              <Button variant="ghost" className="w-full justify-start">తెలుగు (Telugu)</Button>
              <Button variant="ghost" className="w-full justify-start">தமிழ் (Tamil)</Button>
              <Button variant="ghost" className="w-full justify-start">മലയാളം (Malayalam)</Button>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
