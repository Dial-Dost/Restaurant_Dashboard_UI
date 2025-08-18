import { Button } from "@/components/ui/button";
import { Twitter, Instagram, Facebook } from "lucide-react";

export default function Footer() {
  const socialLinks = [
    { icon: <Twitter />, href: "#", "aria-label": "Twitter" },
    { icon: <Instagram />, href: "#", "aria-label": "Instagram" },
    { icon: <Facebook />, href: "#", "aria-label": "Facebook" },
  ];

  return (
    <footer className="bg-muted py-8">
      <div className="container mx-auto px-4 text-center text-muted-foreground">
        <div className="flex justify-center space-x-4 mb-4">
          {socialLinks.map((link, index) => (
            <Button asChild key={index} variant="ghost" size="icon">
              <a href={link.href} aria-label={link['aria-label']}>{link.icon}</a>
            </Button>
          ))}
        </div>
        <p className="text-sm">
          &copy; {new Date().getFullYear()} CuisineFlow. All Rights Reserved.
        </p>
      </div>
    </footer>
  );
}
