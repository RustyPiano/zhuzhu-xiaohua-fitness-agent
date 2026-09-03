import type { SVGProps } from 'react';

type Props = SVGProps<SVGSVGElement>;
const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
export const CalendarIcon = (props: Props) => <svg {...base} {...props}><path d="M7 2v3M17 2v3M3.5 9h17M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z"/><path d="M7 13h3M14 13h3M7 17h3"/></svg>;
export const DumbbellIcon = (props: Props) => <svg {...base} {...props}><path d="M6 8v8M3.5 9.5v5M18 8v8M20.5 9.5v5M6 12h12M2 12h1.5M20.5 12H22"/></svg>;
export const MealIcon = (props: Props) => <svg {...base} {...props}><path d="M6 3v7M3.5 3v5A2.5 2.5 0 0 0 6 10.5V21M8.5 3v5A2.5 2.5 0 0 1 6 10.5M16 3c-2 2.5-2.5 6.5-.5 9h3.5V3M19 3v18"/></svg>;
export const ScaleIcon = (props: Props) => <svg {...base} {...props}><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 10a4 4 0 0 1 8 0M12 10l2-2"/></svg>;
export const PaperclipIcon = (props: Props) => <svg {...base} {...props}><path d="m8.5 12.5 6.1-6.1a3 3 0 0 1 4.2 4.2l-8.2 8.2a5 5 0 0 1-7.1-7.1l8-8"/></svg>;
export const SendIcon = (props: Props) => <svg {...base} {...props}><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>;
export const PlusIcon = (props: Props) => <svg {...base} {...props}><path d="M12 5v14M5 12h14"/></svg>;
export const CheckIcon = (props: Props) => <svg {...base} {...props}><path d="m5 12 4 4L19 6"/></svg>;
export const ChevronIcon = (props: Props) => <svg {...base} {...props}><path d="m9 18 6-6-6-6"/></svg>;
export const EditIcon = (props: Props) => <svg {...base} {...props}><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>;
export const StopIcon = (props: Props) => <svg {...base} {...props}><rect x="7" y="7" width="10" height="10" rx="1"/></svg>;
export const SproutIcon = (props: Props) => <svg {...base} {...props}><path d="M12 21v-7"/><path d="M12 14c0-3 2-5 5-5 0 3-2 5-5 5Z"/><path d="M12 15c0-2.5-1.8-4.5-4.5-4.5C7.5 13 9.3 15 12 15Z"/><path d="M8 21h8"/></svg>;
export const ActivityIcon = (props: Props) => <svg {...base} {...props}><circle cx="15.5" cy="4.5" r="2"/><path d="m13 8-3 4 3 2 2 5M13 8l3 3 3-1M10 12l-4-1M10 16l-3 4"/></svg>;
