import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { AlertTriangle, Check } from 'lucide-react';
import { AbsenceNoticeModal } from './AbsenceNoticeModal';

type Reason = 'sick' | 'family_emergency' | 'transport' | 'other';

interface Notice {
  id: string;
  reason: Reason;
  note: string | null;
  notice_date: string;
  expected_return_date: string | null;
}

const REASON_LABELS: Record<Reason, string> = {
  sick: 'Sick',
  family_emergency: 'Family emergency',
  transport: 'Transport',
  other: 'Other',
};

export function AbsenceNoticeButton() {
  const [showModal, setShowModal] = useState(false);
  const { data } = useQuery({
    queryKey: ['absence-notice-today'],
    queryFn: () => api.get<Notice | null>('/attendance/absence-notice/today'),
    staleTime: 60_000,
  });

  const notice = data?.data ?? null;

  if (notice) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 text-white/60 text-[12px] font-medium">
        <Check className="h-3.5 w-3.5" />
        Reported absence today · {REASON_LABELS[notice.reason]}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 text-white/60 hover:text-white hover:bg-white/5 text-[12px] font-medium transition-colors"
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        Can't make it today?
      </button>
      {showModal && <AbsenceNoticeModal onClose={() => setShowModal(false)} />}
    </>
  );
}
