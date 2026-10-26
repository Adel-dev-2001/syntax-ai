import React from "react";
import { cn } from "../../lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "ghost" | "icon";
  size?: "default" | "sm" | "lg" | "icon";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
          {
            "bg-primary text-primary-foreground shadow hover:bg-primary/90": variant === "default",
            "bg-muted text-foreground shadow-sm hover:bg-muted/80": variant === "secondary",
            "bg-red-700 text-white shadow-sm hover:bg-red-800": variant === "destructive",
            "border border-border bg-transparent shadow-sm hover:bg-muted hover:text-foreground": variant === "outline",
            "hover:bg-muted hover:text-foreground": variant === "ghost",
            "hover:bg-muted hover:text-foreground p-2 rounded-full": variant === "icon",
            "h-9 px-4 py-2": size === "default" && variant !== "icon",
            "h-8 rounded-md px-3 text-xs": size === "sm" && variant !== "icon",
            "h-10 rounded-md px-8": size === "lg" && variant !== "icon",
            "h-9 w-9": size === "icon" || variant === "icon",
          },
          className
        )}
        {...props}
      />
    );
  }
);
Button. displayName = "Button";
