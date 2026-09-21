import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { X, Info, AlertCircle } from 'lucide-react';

const buttonVariants = cva('button', { variants: { variant: { default: 'button-primary', outline: 'button-outline', ghost: 'button-ghost', destructive: 'button-destructive' } }, defaultVariants: { variant: 'outline' } });
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean }>(({ className, variant, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp ref={ref} className={twMerge(clsx(buttonVariants({ variant }), className))} {...props} />;
});
Button.displayName = 'Button';
export function Tabs({ value, onValueChange, label, items, children }: { value: string; onValueChange: (value: string) => void; label: string; items: { value: string; label: ReactNode }[]; children?: ReactNode }) {
  return <TabsPrimitive.Root value={value} onValueChange={onValueChange}><TabsPrimitive.List className="tabs" aria-label={label}>{items.map(item => <TabsPrimitive.Trigger className="tab" value={item.value} key={item.value}>{item.label}</TabsPrimitive.Trigger>)}</TabsPrimitive.List>{children}</TabsPrimitive.Root>;
}
export const TabContent = TabsPrimitive.Content;
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={`notice ${error ? 'notice-error' : ''}`} role={error ? 'alert' : 'status'}>{error ? <AlertCircle aria-hidden="true" /> : <Info aria-hidden="true" />}<div>{children}</div></div>;
}
export function Dialog({ open, onOpenChange, trigger, title, description, children, returnFocus }: { open: boolean; onOpenChange: (open: boolean) => void; trigger: ReactNode; title: string; description: string; children: ReactNode; returnFocus?: () => HTMLElement | null }) {
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}><DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger><DialogPrimitive.Portal><DialogPrimitive.Overlay className="dialog-overlay" /><DialogPrimitive.Content className="dialog-content" onCloseAutoFocus={event => { const target = returnFocus?.(); if (target) { event.preventDefault(); target.focus(); } }}><DialogPrimitive.Title>{title}</DialogPrimitive.Title><DialogPrimitive.Description className="muted">{description}</DialogPrimitive.Description>{children}<DialogPrimitive.Close asChild><Button className="dialog-close" variant="ghost" aria-label="Đóng"><X /></Button></DialogPrimitive.Close></DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>;
}
