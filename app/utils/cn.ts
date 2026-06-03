import { twMerge } from "tailwind-merge";

type ClassValue =
  | string
  | number
  | boolean
  | undefined
  | null
  | Array<string | number | boolean | undefined | null>;

/**
 * Merge class names with Tailwind CSS class conflict resolution.
 * Later classes override earlier conflicting ones (e.g., cn('px-4', 'p-0') → 'p-0')
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(inputs.flat(Infinity).filter(Boolean).join(" "));
}
