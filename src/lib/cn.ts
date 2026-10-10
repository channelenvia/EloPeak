import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// Vive sozinho (sem date-fns): componentes base importam so isto e nao arrastam as helpers de data/moeda.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
