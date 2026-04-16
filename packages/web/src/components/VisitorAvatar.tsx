import { getInitials } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface VisitorAvatarProps {
  firstName: string;
  lastName: string;
  photoUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: 'w-9 h-9 text-[12px]',
  md: 'w-10 h-10 text-[13px]',
  lg: 'w-14 h-14 text-lg',
};

export function VisitorAvatar({ firstName, lastName, photoUrl, size = 'md', className }: VisitorAvatarProps) {
  if (photoUrl) {
    return (
      <div className={cn('rounded-xl overflow-hidden shrink-0', sizeMap[size], className)}>
        <img
          src={photoUrl}
          alt={`${firstName} ${lastName}`}
          className="w-full h-full object-cover"
          onError={(e) => {
            // Fallback to initials on load error
            (e.target as HTMLImageElement).style.display = 'none';
            (e.target as HTMLImageElement).parentElement!.classList.add('bg-primary/10');
            (e.target as HTMLImageElement).parentElement!.innerHTML = `<span class="text-primary font-bold">${getInitials(firstName, lastName)}</span>`;
          }}
        />
      </div>
    );
  }

  return (
    <div className={cn(
      'rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold shrink-0',
      sizeMap[size],
      className
    )}>
      {getInitials(firstName, lastName)}
    </div>
  );
}
