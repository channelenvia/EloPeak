import { toast } from 'sonner'

// Único ponto de import do sonner: trocar de lib de toast é mexer só aqui e em components/AppToaster.
export const notifySuccess = (message: string): void => { toast.success(message) }
export const notifyError = (message: string): void => { toast.error(message) }
