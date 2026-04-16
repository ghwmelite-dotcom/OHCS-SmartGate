import { useToastStore } from '@/stores/toast';
import { cn } from '@/lib/utils';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

const icons = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const styles = {
  success: 'bg-primary text-white',
  error: 'bg-secondary text-white',
  info: 'bg-foreground text-background',
};

export function Toaster() {
  const { toasts, remove } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 right-6 z-[60] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => {
        const Icon = icons[t.type];
        return (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl min-w-[280px] max-w-[380px] animate-slide-in-right',
              styles[t.type]
            )}
          >
            <Icon className="h-5 w-5 shrink-0" />
            <p className="text-[14px] font-medium flex-1">{t.message}</p>
            <button onClick={() => remove(t.id)} className="h-6 w-6 rounded-md flex items-center justify-center opacity-60 hover:opacity-100 shrink-0">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
