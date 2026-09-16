import {
  ArrowDown, ArrowRight, ArrowUpRight, CakeSlice, CalendarHeart, ChevronDown,
  CircleHelp, CreditCard, Flower2, Gift, HandHeart, Heart, Info, Leaf, Mail,
  MapPin, PackageOpen, PenLine, Plus, Sparkles, Sprout, Truck,
} from "lucide-react";

const icons = {
  arrow: ArrowRight, down: ArrowDown, external: ArrowUpRight, cake: CakeSlice,
  calendar: CalendarHeart, chevron: ChevronDown, help: CircleHelp, card: CreditCard,
  flower: Flower2, gift: Gift, thanks: HandHeart, heart: Heart, info: Info,
  leaf: Leaf, mail: Mail, pin: MapPin, box: PackageOpen, pen: PenLine,
  plus: Plus, sparkle: Sparkles, sprout: Sprout, truck: Truck,
};

export type HomeIconName = keyof typeof icons;

/** A small static Lucide set; surrounding labels carry meaning for assistive technology. */
export function HomeIcon({ name, size = 24, className = "" }: { name: HomeIconName; size?: number; className?: string }) {
  const Icon = icons[name];
  return <Icon className={`home-icon ${className}`} size={size} strokeWidth={1.65} aria-hidden="true" focusable="false" />;
}
